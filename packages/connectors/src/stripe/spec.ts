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
import {
  fetchAccount,
  listCharges,
  listCustomers,
  listInvoices,
  listSubscriptions,
} from './api';
import { processStripeRecord } from './chunking';
import type {
  StripeAnyObject,
  StripeCharge,
  StripeCustomer,
  StripeInvoice,
  StripeList,
  StripeObjectType,
  StripeSubscription,
} from './types';
import type { HttpClient } from '@holo/connector-framework';

export interface StripeSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Per-resource cursor. We don't watermark on `created` because subscriptions
 * and invoices mutate (status, cancel_at, amount_paid) without bumping
 * `created` — a `created` cursor would silently miss those state changes.
 * Instead each incremental run walks Stripe's list endpoints from the top
 * (newest first) and stops once it sees `lastSeenId`, the most-recent id
 * from the previous run. `MAX_PAGES_PER_RESOURCE` caps the worst case
 * (first-ever run on a large account) so the sync window stays bounded.
 */
const resourceCursorSchema = z
  .object({
    lastSeenId: z.string().optional(),
  })
  .default({});

type ResourceCursor = z.infer<typeof resourceCursorSchema>;

const MAX_PAGES_PER_RESOURCE = 50; // 50 × 100 = 5_000 records per resource per run

interface ResourceConfig<T extends StripeAnyObject> {
  id: 'customers' | 'subscriptions' | 'invoices' | 'charges';
  displayName: string;
  recordType: StripeObjectType;
  list(api: HttpClient, opts: { startingAfter?: string }): Promise<StripeList<T>>;
}

function buildResource<T extends StripeAnyObject>(cfg: ResourceConfig<T>): {
  id: string;
  displayName: string;
  cursorSchema: typeof resourceCursorSchema;
  sync(ctx: ResourceSyncContext<ResourceCursor>): Promise<ResourceCursor>;
} {
  return {
    id: cfg.id,
    displayName: cfg.displayName,
    cursorSchema: resourceCursorSchema,
    async sync(ctx: ResourceSyncContext<ResourceCursor>): Promise<ResourceCursor> {
      let startingAfter: string | undefined;
      let pageNum = 0;
      let newLastSeenId: string | undefined;
      let stopped = false;

      while (!stopped && pageNum < MAX_PAGES_PER_RESOURCE) {
        ctx.signal?.throwIfAborted();
        pageNum += 1;
        ctx.reportProgress?.({
          current: pageNum,
          total: null,
          message: `Fetching ${cfg.id} · page ${pageNum}`,
        });

        let page: StripeList<T>;
        try {
          page = await cfg.list(ctx.api, { startingAfter });
        } catch {
          // Listing failure aborts THIS resource only — the runtime moves
          // on to the next resource on the next iteration. Matches the
          // HubSpot/Pylon behavior.
          break;
        }

        const records = page.data ?? [];
        if (records.length === 0) break;

        // Stripe returns newest first. The first record we see this run is
        // the new high watermark; subsequent runs will stop here.
        if (!newLastSeenId) newLastSeenId = records[0]!.id;

        for (const r of records) {
          ctx.signal?.throwIfAborted();
          if (ctx.cursor.lastSeenId && r.id === ctx.cursor.lastSeenId) {
            // Caught up to the previous run's watermark — everything below
            // this point was already indexed. Subscriptions/invoices/charges
            // that mutate after the watermark are NOT re-indexed by this
            // strategy; we accept that tradeoff for the daily cadence
            // (operators get a fresh status snapshot every 6h, not real-time).
            stopped = true;
            break;
          }
          await processStripeRecord(ctx, cfg.recordType, r);
        }

        if (stopped) break;
        if (!page.has_more) break;
        startingAfter = records[records.length - 1]!.id;
      }

      // If we never saw a record this run (empty account), preserve the
      // previous cursor so we don't lose the watermark.
      return { lastSeenId: newLastSeenId ?? ctx.cursor.lastSeenId };
    },
  };
}

export function createStripeSpec(_opts: StripeSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'stripe',
    displayName: 'Stripe',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.stripe },

    // Stripe accepts the secret key as either Basic-auth username (legacy)
    // or Bearer (current). Bearer matches every other apiKey connector here.
    auth: apiKey({ prefix: 'Bearer ' }),

    http: {
      baseUrl: 'https://api.stripe.com',
      defaultHeaders: {
        Accept: 'application/json',
        // Pin the API version so a Stripe-side change doesn't quietly alter
        // response shapes after a connector upgrade. Bump deliberately when
        // we want a new field; the rest of the connector targets this version.
        'Stripe-Version': '2024-12-18.acacia',
      },
      // Stripe publishes a 100 req/s read limit (live) / 25 req/s (test).
      // The framework's exponential backoff on 429/5xx handles brief
      // exceedances; we don't need a token bucket here.
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const acct = await fetchAccount(ctx.api);
      const name =
        acct.settings?.dashboard?.display_name ??
        acct.business_profile?.name ??
        acct.email ??
        acct.id;
      return {
        externalId: acct.id,
        name,
        raw: { account_id: acct.id, account_name: name },
      };
    },

    resources: [
      buildResource<StripeCustomer>({
        id: 'customers',
        displayName: 'Customers',
        recordType: 'customer',
        list: (api, opts) => listCustomers(api, opts),
      }),
      buildResource<StripeSubscription>({
        id: 'subscriptions',
        displayName: 'Subscriptions',
        recordType: 'subscription',
        list: (api, opts) => listSubscriptions(api, opts),
      }),
      buildResource<StripeInvoice>({
        id: 'invoices',
        displayName: 'Invoices',
        recordType: 'invoice',
        list: (api, opts) => listInvoices(api, opts),
      }),
      buildResource<StripeCharge>({
        id: 'charges',
        displayName: 'Charges',
        recordType: 'charge',
        list: (api, opts) => listCharges(api, opts),
      }),
    ],

    ui: {
      description:
        'Customers, subscriptions, invoices, and charges — for revenue, MRR, and growth metrics.',
      category: 'payments',
    },
  });
}
