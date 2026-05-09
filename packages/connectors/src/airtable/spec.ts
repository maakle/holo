import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  isStatus,
  iterateBases,
  iterateRecords,
  listTables,
  whoami,
} from './api';
import { processRecord } from './chunking';
import type { AirtableBase } from './types';

export interface AirtableSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const recordsCursorSchema = z
  .object({
    /**
     * Per-(base,table) ISO timestamp of the latest record we ingested. The
     * key is `${baseId}:${tableId}` so a single connector can sync many
     * tables across many bases under one cursor row.
     */
    lastModifiedPerTable: z.record(z.string(), z.string()).default({}),
  })
  .default({ lastModifiedPerTable: {} });

type RecordsCursor = z.infer<typeof recordsCursorSchema>;

/**
 * Wildcard expansion: when the operator's allowlist contains a `*` glob,
 * the integration's Airtable-side share boundary is the access policy. We
 * enumerate every base the token can see (capped to 100 to avoid runaway
 * walks) and treat that as the resolved base set. Returns the bases (not
 * just ids) so the caller can reuse the names in chunk content without a
 * second meta walk.
 */
async function expandWildcardToAccessibleBases(
  ctx: ResourceSyncContext<RecordsCursor>,
): Promise<AirtableBase[]> {
  const out: AirtableBase[] = [];
  for await (const base of iterateBases(ctx.api, ctx.signal)) {
    out.push(base);
    if (out.length >= 100) break;
  }
  return out;
}

export function createAirtableSpec(_opts: AirtableSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'airtable',
    displayName: 'Airtable',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.airtable },

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.airtable.com/v0',
      defaultHeaders: { Accept: 'application/json' },
      // Airtable's documented limit is 5 rps per base; we sync sequentially
      // across bases so a global 4 rps with a small burst stays comfortably
      // under that. The framework's 429 + Retry-After absorbs any pushback.
      // https://airtable.com/developers/web/api/rate-limits
      rateLimit: { rps: 4, burst: 8 },
      retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      try {
        const me = await whoami(ctx.api);
        return {
          externalId: me.id,
          name: me.email ?? me.id,
          raw: {
            id: me.id,
            ...(me.email !== undefined && { email: me.email }),
            ...(me.scopes !== undefined && { scopes: me.scopes }),
          },
        };
      } catch (err) {
        if (isStatus(err, 401) || isStatus(err, 403)) {
          throw holoError({
            code: ErrorCode.HOLO_AIRTABLE_TOKEN_INVALID,
            problem: `Airtable returned ${isStatus(err, 401) ? '401' : '403'} — personal access token is invalid or missing scopes`,
            fix: 'Create a token at https://airtable.com/create/tokens with the `data.records:read`, `schema.bases:read`, and `user.email:read` scopes, plus access to the bases you want to sync.',
          });
        }
        throw err;
      }
    },

    resources: [
      {
        id: 'records',
        displayName: 'Records',
        cursorSchema: recordsCursorSchema,
        async sync(ctx: ResourceSyncContext<RecordsCursor>): Promise<RecordsCursor> {
          // Allowlist values are base ids ("appXXXXXXXXXXXXXX"); the connect
          // route auto-populates a `*` glob on first connect, mirroring the
          // Notion approach (the access boundary is the token's scope on
          // Airtable's side). Operators can later narrow via
          // `holo allowlist add airtable <baseId>`.
          const result = evaluateAllowlist(ctx.allowlist, {
            provider: 'airtable',
            organizationId: ctx.organizationId,
          });

          ctx.reportProgress?.({
            current: 0,
            total: null,
            message: 'Resolving accessible bases…',
          });
          // For wildcard syncs we already have the base list (with names)
          // from the meta walk. For explicit allowlists we still walk meta
          // once to resolve names — cheap (one page per ~1k bases) and lets
          // us put the human-readable base name into chunk content.
          const bases: AirtableBase[] = result.resolved.includes('*')
            ? await expandWildcardToAccessibleBases(ctx)
            : await (async () => {
                const want = new Set(result.resolved);
                const out: AirtableBase[] = [];
                for await (const b of iterateBases(ctx.api, ctx.signal)) {
                  if (want.has(b.id)) out.push(b);
                  if (out.length === want.size) break;
                }
                // Bases the operator allowlisted but the token can't see
                // surface as a synthetic entry so the sync still attempts
                // them (and gracefully skips on the 403 handler below).
                for (const id of want) {
                  if (!out.some((b) => b.id === id)) out.push({ id, name: id });
                }
                return out;
              })();

          if (bases.length === 0) {
            return ctx.cursor;
          }

          const lastModifiedPerTable = { ...(ctx.cursor.lastModifiedPerTable ?? {}) };

          let baseIdx = 0;
          for (const base of bases) {
            ctx.signal?.throwIfAborted();
            baseIdx += 1;
            ctx.reportProgress?.({
              current: baseIdx,
              total: bases.length,
              message: `Syncing base ${base.name}`,
            });

            let tables;
            try {
              tables = await listTables(ctx.api, base.id);
            } catch (err) {
              if (isStatus(err, 403) || isStatus(err, 404)) {
                // Token can't see this base (revoked, base deleted, or
                // missing scope). Skip rather than aborting the whole sync.
                continue;
              }
              throw err;
            }

            for (const table of tables) {
              ctx.signal?.throwIfAborted();
              const cursorKey = `${base.id}:${table.id}`;
              const since = lastModifiedPerTable[cursorKey];
              // Airtable's formula language: LAST_MODIFIED_TIME() returns
              // the most recent modification time for the record across all
              // its fields. Comparing to a DATETIME literal is the canonical
              // incremental filter.
              const filterByFormula = since
                ? `IS_AFTER(LAST_MODIFIED_TIME(), DATETIME_PARSE("${since}"))`
                : undefined;

              let highest = since;
              for await (const record of iterateRecords(ctx.api, base.id, table.id, {
                filterByFormula,
                signal: ctx.signal,
              })) {
                ctx.signal?.throwIfAborted();
                await processRecord(ctx, { record, base, table });
                // `createdTime` is exposed at the top level; LAST_MODIFIED_TIME
                // isn't, so we use createdTime as a conservative high-water mark.
                // Records with later edits will be picked up on the next sync
                // when the formula filter compares against the new value.
                if (!highest || record.createdTime > highest) {
                  highest = record.createdTime;
                }
              }
              if (highest) {
                lastModifiedPerTable[cursorKey] = highest;
              }
            }

            // Per-base checkpoint so a mid-sync crash doesn't replay
            // already-enqueued tables on the next run.
            await ctx.flushCursor({ lastModifiedPerTable });
          }

          return { lastModifiedPerTable };
        },
      },
    ],

    ui: {
      description: 'Bases, tables, and records the personal access token has access to.',
      category: 'other',
    },
  });
}
