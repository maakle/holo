import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  createHttpClient,
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type HttpConfig,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { fetchIdentity, listRecords, queryNext } from './api';
import { processRecordBatch } from './chunking';
import type {
  SalesforceQueryResponse,
  SalesforceRecord,
  SalesforceResourceId,
} from './types';

/**
 * Salesforce uses OAuth 2.0 Web Server Flow with refresh tokens. Access tokens
 * expire (default 2h, tunable per Connected App), so the connector relies on
 * the framework's pre-sync refresh path. Scopes:
 *   - api          — read CRM data via REST/SOQL
 *   - refresh_token / offline_access — issue a refresh_token alongside the
 *     access token (Salesforce requires both names)
 */
export const SALESFORCE_SCOPES = ['api', 'refresh_token', 'offline_access'] as const;

const PLACEHOLDER_BASE_URL = 'https://example.invalid';

const PER_TENANT_HTTP: Omit<HttpConfig, 'baseUrl'> = {
  // Salesforce surfaces 24h API limits per org; pacing here keeps us well
  // under the per-second burst the platform tolerates. The framework retries
  // on the documented transient codes.
  rateLimit: { rps: 20, burst: 50 },
  retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
};

export interface SalesforceSpecOptions {
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /**
   * Override the OAuth login host. Defaults to `login.salesforce.com`
   * (production / developer orgs); tests pass an in-memory host. Sandbox
   * support (`test.salesforce.com`) is a follow-up.
   */
  loginHost?: string;
}

const objectCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent SystemModstamp we've ingested. */
    updatedAt: z.string().optional(),
  })
  .default({});

type ObjectCursor = z.infer<typeof objectCursorSchema>;

function requireInstanceUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['instanceUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Salesforce source ${ctx.sourceId} has no instanceUrl in metadata`,
      fix: 'Reconnect Salesforce via /connections so the source row is initialised correctly.',
    });
  }
  return url;
}

function buildResource(
  resourceId: SalesforceResourceId,
  fetchImpl: typeof fetch | undefined,
  auth: ReturnType<typeof oauth2>,
): {
  id: SalesforceResourceId;
  displayName: string;
  cursorSchema: typeof objectCursorSchema;
  sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor>;
} {
  return {
    id: resourceId,
    displayName: resourceId[0]!.toUpperCase() + resourceId.slice(1),
    cursorSchema: objectCursorSchema,
    async sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor> {
      const instanceUrl = requireInstanceUrl(ctx);
      const api = createHttpClient({
        config: { ...PER_TENANT_HTTP, baseUrl: instanceUrl },
        auth,
        tokens: ctx.tokens,
        fetchImpl,
      });

      const objectMap: Record<SalesforceResourceId, 'Account' | 'Contact' | 'Opportunity'> = {
        accounts: 'Account',
        contacts: 'Contact',
        opportunities: 'Opportunity',
      };
      const object = objectMap[resourceId];

      let highest = ctx.cursor.updatedAt;
      let pageNum = 0;
      let page: SalesforceQueryResponse;

      try {
        page = await listRecords(api, object, { updatedAfter: ctx.cursor.updatedAt });
      } catch {
        // Listing failure aborts THIS resource only — the runtime moves on
        // to the next resource on the next iteration.
        return ctx.cursor;
      }

      while (true) {
        ctx.signal?.throwIfAborted();
        pageNum += 1;
        ctx.reportProgress?.({
          current: pageNum,
          total: null,
          message: `Fetching ${resourceId} · page ${pageNum}`,
        });

        const records = page.records ?? [];
        await processRecordBatch(ctx, api, resourceId, records);
        for (const r of records as SalesforceRecord[]) {
          if (!highest || r.SystemModstamp > highest) highest = r.SystemModstamp;
        }

        if (page.done || !page.nextRecordsUrl) break;
        try {
          page = await queryNext(api, page.nextRecordsUrl);
        } catch {
          break;
        }
      }

      return { updatedAt: highest };
    },
  };
}

export function createSalesforceSpec(opts: SalesforceSpecOptions): ConnectorSpec {
  const loginHost = opts.loginHost ?? 'login.salesforce.com';
  const fetchImpl = opts.fetchImpl;
  const auth = oauth2({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    authorizeUrl: `https://${loginHost}/services/oauth2/authorize`,
    tokenUrl: `https://${loginHost}/services/oauth2/token`,
    scopes: SALESFORCE_SCOPES,
    refreshable: true,
    fetchImpl,
  });

  return defineConnector({
    id: 'salesforce',
    displayName: 'Salesforce',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.salesforce },

    auth,

    http: {
      // Placeholder. Every resource constructs its own per-tenant client
      // because the per-org `instance_url` only becomes known after the
      // OAuth callback and lives on `sources.metadata.instanceUrl`.
      baseUrl: PLACEHOLDER_BASE_URL,
      ...PER_TENANT_HTTP,
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The connect route stashes the identity URL on the tokens it hands in
      // (we abuse `scope` since ConnectorTokens has no extension point), then
      // hits the identity endpoint with the access token. The route also
      // captures `instance_url` separately into sources.metadata.
      const idUrl = (ctx.tokens as { idUrl?: string }).idUrl;
      if (!idUrl) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'Salesforce token exchange did not return an identity URL',
          fix: 'Restart the connect flow; this usually indicates a malformed Connected App.',
        });
      }
      const ident = await fetchIdentity(fetchImpl ?? fetch, idUrl, ctx.tokens.accessToken);
      return {
        externalId: ident.organization_id,
        name: ident.display_name || ident.username,
        raw: {
          organization_id: ident.organization_id,
          user_id: ident.user_id,
          username: ident.username,
        },
      };
    },

    resources: [
      buildResource('accounts', fetchImpl, auth),
      buildResource('contacts', fetchImpl, auth),
      buildResource('opportunities', fetchImpl, auth),
    ],

    ui: {
      description: 'CRM accounts, contacts, opportunities, and activity timelines.',
      category: 'crm',
    },
  });
}
