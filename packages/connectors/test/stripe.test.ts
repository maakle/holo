import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createStripeSpec } from '../src/stripe/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: { existingHashes?: string[]; cursors?: Record<string, unknown> }): {
  stores: RuntimeStores;
  enqueued: ChunkRecord[];
  savedCursors: Array<{ resourceId: string; cursor: unknown }>;
} {
  const enqueued: ChunkRecord[] = [];
  const savedCursors: Array<{ resourceId: string; cursor: unknown }> = [];
  const cursors = { ...(initial?.cursors ?? {}) };
  return {
    enqueued,
    savedCursors,
    stores: {
      async loadTokens() {
        return { accessToken: 'sk_test_dummy' };
      },
      async loadCursor({ resourceId }) {
        return cursors[resourceId];
      },
      async saveCursor({ resourceId, cursor }) {
        cursors[resourceId] = cursor;
        savedCursors.push({ resourceId, cursor });
      },
      async loadExistingHashes() {
        return new Set(initial?.existingHashes ?? []);
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

// Empty-list response for resources we aren't testing on this run.
function emptyList(): Response {
  return jsonResponse({ object: 'list', data: [], has_more: false });
}

function routeForUrl(url: string): 'customers' | 'subscriptions' | 'invoices' | 'charges' | 'account' | 'other' {
  if (url.includes('/v1/customers')) return 'customers';
  if (url.includes('/v1/subscriptions')) return 'subscriptions';
  if (url.includes('/v1/invoices')) return 'invoices';
  if (url.includes('/v1/charges')) return 'charges';
  if (url.includes('/v1/account')) return 'account';
  return 'other';
}

describe('createStripeSpec', () => {
  it('declares the expected id, http config, four resources, and apiKey auth', () => {
    const spec = createStripeSpec();
    expect(spec.id).toBe('stripe');
    expect(spec.displayName).toBe('Stripe');
    expect(spec.http?.baseUrl).toBe('https://api.stripe.com');
    expect(spec.resources.map((r) => r.id)).toEqual([
      'customers',
      'subscriptions',
      'invoices',
      'charges',
    ]);
    expect(spec.auth.kind).toBe('apiKey');
    expect(spec.ui?.category).toBe('payments');
  });

  it('pins the Stripe-Version header so response shapes are stable', () => {
    const spec = createStripeSpec();
    expect(spec.http?.defaultHeaders?.['Stripe-Version']).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('Stripe sync (full)', () => {
  it('indexes a customer, subscription with MRR, paid invoice, and charge', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const route = routeForUrl(req.url);
      if (route === 'customers') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cus_1',
              object: 'customer',
              created: 1_704_067_200, // 2024-01-01
              email: 'ops@acme.example',
              name: 'Acme Corp',
              livemode: true,
              currency: 'usd',
            },
          ],
        });
      }
      if (route === 'subscriptions') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'sub_1',
              object: 'subscription',
              created: 1_704_067_200,
              status: 'active',
              customer: 'cus_1',
              livemode: true,
              currency: 'usd',
              items: {
                data: [
                  {
                    id: 'si_1',
                    quantity: 2,
                    price: {
                      id: 'price_1',
                      unit_amount: 4900, // $49.00
                      currency: 'usd',
                      nickname: 'Pro Monthly',
                      recurring: { interval: 'month', interval_count: 1 },
                    },
                  },
                ],
              },
            },
          ],
        });
      }
      if (route === 'invoices') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'in_1',
              object: 'invoice',
              created: 1_706_745_600,
              number: 'ACME-0001',
              status: 'paid',
              customer: 'cus_1',
              amount_due: 9800,
              amount_paid: 9800,
              amount_remaining: 0,
              currency: 'usd',
              paid: true,
              livemode: true,
            },
          ],
        });
      }
      if (route === 'charges') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'ch_1',
              object: 'charge',
              created: 1_706_745_600,
              amount: 9800,
              currency: 'usd',
              status: 'succeeded',
              customer: 'cus_1',
              livemode: true,
              payment_method_details: { type: 'card' },
            },
          ],
        });
      }
      return emptyList();
    });

    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();

    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBe(4);
    const kinds = enqueued.map((c) => c.kind).sort();
    expect(kinds).toEqual([
      'stripe-charge',
      'stripe-customer',
      'stripe-invoice',
      'stripe-subscription',
    ]);

    const sub = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    expect(sub.sourceArtifactId).toBe('stripe-subscription:sub_1');
    // $49 × qty 2 × monthly = $98 MRR.
    expect(sub.metadata['mrr']).toBeCloseTo(98, 2);
    expect(sub.metadata['plan']).toBe('Pro Monthly');
    expect(sub.metadata['status']).toBe('active');
    expect(sub.content).toContain('MRR: USD 98.00');

    const inv = enqueued.find((c) => c.kind === 'stripe-invoice')!;
    expect(inv.metadata['amount']).toBeCloseTo(98, 2);
    expect(inv.metadata['status']).toBe('paid');

    const ch = enqueued.find((c) => c.kind === 'stripe-charge')!;
    expect(ch.metadata['amount']).toBeCloseTo(98, 2);
    expect(ch.metadata['currency']).toBe('usd');

    // Auth attached to every request.
    expect(calls[0]!.headers.get('Authorization')).toBe('Bearer sk_test_dummy');
    // Stripe-Version pinned.
    expect(calls[0]!.headers.get('Stripe-Version')).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('paginates customers via starting_after and stops on has_more=false', async () => {
    const startingAfterSeen: string[] = [];
    const { fetchImpl } = makeFetch((req) => {
      const route = routeForUrl(req.url);
      if (route !== 'customers') return emptyList();
      const m = req.url.match(/starting_after=([^&]+)/);
      const after = m ? decodeURIComponent(m[1]!) : null;
      if (after) startingAfterSeen.push(after);
      if (after === 'cus_page1_last') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'cus_3',
              object: 'customer',
              created: 1_704_067_200,
              livemode: true,
            },
          ],
        });
      }
      return jsonResponse({
        object: 'list',
        has_more: true,
        data: [
          { id: 'cus_1', object: 'customer', created: 1_704_067_200, livemode: true },
          {
            id: 'cus_page1_last',
            object: 'customer',
            created: 1_704_067_200,
            livemode: true,
          },
        ],
      });
    });

    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const customerChunks = enqueued.filter((c) => c.kind === 'stripe-customer');
    expect(customerChunks).toHaveLength(3);
    expect(startingAfterSeen).toContain('cus_page1_last');
  });

  it('stops paginating a resource when it sees the cursor watermark', async () => {
    const requests: string[] = [];
    const { fetchImpl } = makeFetch((req) => {
      const route = routeForUrl(req.url);
      if (route !== 'customers') return emptyList();
      requests.push(req.url);
      // Pretend Stripe has the same 3 records every time, newest first. The
      // cursor below says cus_2 was the watermark last run.
      return jsonResponse({
        object: 'list',
        has_more: true,
        data: [
          { id: 'cus_4', object: 'customer', created: 1_710_000_000, livemode: true },
          { id: 'cus_3', object: 'customer', created: 1_709_000_000, livemode: true },
          { id: 'cus_2', object: 'customer', created: 1_708_000_000, livemode: true },
          { id: 'cus_1', object: 'customer', created: 1_707_000_000, livemode: true },
        ],
      });
    });
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores({
      cursors: { customers: { lastSeenId: 'cus_2' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const ids = enqueued.filter((c) => c.kind === 'stripe-customer').map((c) => c.externalId);
    expect(ids).toEqual(['cus_4', 'cus_3']);
    // Watermark advances to the newest id we saw this run.
    expect(result.cursorPatch['customers']).toEqual({ lastSeenId: 'cus_4' });
    // Only one customer request: we stopped before paginating further.
    expect(requests).toHaveLength(1);
  });

  it('preserves the existing cursor when no new records are returned', async () => {
    const { fetchImpl } = makeFetch(() => emptyList());
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores({
      cursors: { customers: { lastSeenId: 'cus_99' } },
    });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(enqueued).toHaveLength(0);
    expect(result.cursorPatch['customers']).toEqual({ lastSeenId: 'cus_99' });
  });

  it('renders zero-decimal currency amounts without dividing by 100', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (routeForUrl(req.url) !== 'charges') return emptyList();
      return jsonResponse({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'ch_jpy',
            object: 'charge',
            created: 1_704_067_200,
            amount: 12000, // ¥12,000 (no decimals)
            currency: 'jpy',
            status: 'succeeded',
            livemode: true,
          },
        ],
      });
    });
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const ch = enqueued.find((c) => c.kind === 'stripe-charge')!;
    expect(ch.content).toContain('JPY 12000');
    expect(ch.metadata['amount']).toBe(12000);
  });
});

describe('Stripe testConnection', () => {
  it('returns the account id and display name from /v1/account', async () => {
    const { fetchImpl } = makeFetch(() =>
      jsonResponse({
        id: 'acct_123',
        email: 'finance@acme.example',
        settings: { dashboard: { display_name: 'Acme' } },
      }),
    );
    const spec = createStripeSpec();
    const { createHttpClient, apiKey } = await import('@holo/connector-framework');
    const api = createHttpClient({
      config: spec.http!,
      auth: apiKey({ prefix: 'Bearer ' }),
      tokens: { accessToken: 'k' },
      fetchImpl,
      sleep: async () => {},
    });
    const result = await spec.testConnection({ api, tokens: { accessToken: 'k' } });
    expect(result.externalId).toBe('acct_123');
    expect(result.name).toBe('Acme');
  });
});
