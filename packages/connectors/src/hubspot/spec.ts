import { z } from 'zod';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { listRecords } from './api';
import { processRecord } from './chunking';
import type { HubspotObjectType, HubspotPage } from './types';

export interface HubspotSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const objectCursorSchema = z
  .object({
    /** ISO timestamp of the most-recent record we've ingested for this object type. */
    updatedAt: z.string().optional(),
  })
  .default({});

type ObjectCursor = z.infer<typeof objectCursorSchema>;

/**
 * One resource per HubSpot object type. Each resource has its own
 * `connector_cursors.scope` row (`scope='contacts'`, etc.), so a slow deals
 * sync doesn't hold up new contacts.
 */
function buildObjectResource(objectType: HubspotObjectType): {
  id: string;
  displayName: string;
  cursorSchema: typeof objectCursorSchema;
  sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor>;
} {
  return {
    id: objectType,
    displayName: objectType[0]!.toUpperCase() + objectType.slice(1),
    cursorSchema: objectCursorSchema,
    async sync(ctx: ResourceSyncContext<ObjectCursor>): Promise<ObjectCursor> {
      let after: string | undefined;
      let highest = ctx.cursor.updatedAt;
      let pageNum = 0;

      do {
        ctx.signal?.throwIfAborted();
        pageNum += 1;
        ctx.reportProgress?.({
          current: pageNum,
          total: null,
          message: `Fetching ${objectType} · page ${pageNum}`,
        });

        let page: HubspotPage;
        try {
          page = await listRecords(ctx.api, objectType, {
            updatedAfter: ctx.cursor.updatedAt,
            after,
          });
        } catch {
          // Listing failure aborts THIS resource only — the runtime moves
          // on to the next resource on the next iteration.
          break;
        }

        for (const record of page.results ?? []) {
          ctx.signal?.throwIfAborted();
          await processRecord(ctx, objectType, record);
          if (!highest || record.updatedAt > highest) highest = record.updatedAt;
        }

        after = page.paging?.next?.after;
      } while (after);

      return { updatedAt: highest };
    },
  };
}

export function createHubspotSpec(_opts: HubspotSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'hubspot',
    displayName: 'HubSpot',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.hubspot },

    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.hubapi.com',
      defaultHeaders: { Accept: 'application/json' },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const raw = await ctx.api.get<{
        portalId?: number;
        hub_id?: number;
        accountType?: string;
        timeZone?: string;
      }>('/account-info/v3/details');
      const id = String(raw.portalId ?? raw.hub_id ?? 'unknown');
      const name = raw.accountType ? `Hub ${id} (${raw.accountType})` : `Hub ${id}`;
      return { externalId: id, name, raw: { hub_id: id, hub_name: name } };
    },

    resources: [
      buildObjectResource('contacts'),
      buildObjectResource('deals'),
      buildObjectResource('companies'),
    ],

    ui: {
      description: 'CRM contacts, deals, companies, and engagement timelines.',
      category: 'crm',
    },
  });
}
