import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createStripeSpec } from '../src/stripe/index';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
}): {
  stores: RuntimeStores;
  enqueued: ChunkRecord[];
  savedCursors: Array<{ resourceId: string; cursor: unknown }>;
} {
  const enqueued: ChunkRecord[] = [];
  const savedCursors: Array<{ resourceId: string; cursor: unknown }> = [];
  const cursors = { ...(initial?.cursors ?? {}) };
  const sourceMetadata = initial?.sourceMetadata ?? {};
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
      async loadSourceMetadata() {
        return sourceMetadata;
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

describe('Stripe discounts on subscriptions', () => {
  function subscriptionWith(discount: unknown, discounts?: unknown): unknown {
    return {
      id: 'sub_disc',
      object: 'subscription',
      created: 1_704_067_200,
      status: 'active',
      customer: 'cus_1',
      livemode: true,
      currency: 'usd',
      ...(discount !== undefined ? { discount } : {}),
      ...(discounts !== undefined ? { discounts } : {}),
      items: {
        data: [
          {
            id: 'si_1',
            quantity: 1,
            price: {
              id: 'price_1',
              unit_amount: 10000, // $100
              currency: 'usd',
              nickname: 'Pro',
              recurring: { interval: 'month', interval_count: 1 },
            },
          },
        ],
      },
    };
  }

  function subscriptionsResponder(sub: unknown): (req: CapturedRequest) => Response {
    return (req) => {
      if (routeForUrl(req.url) === 'subscriptions') {
        return jsonResponse({ object: 'list', has_more: false, data: [sub] });
      }
      return emptyList();
    };
  }

  it('applies a percent_off coupon to MRR and emits mrr_gross + discount metadata', async () => {
    const sub = subscriptionWith({
      coupon: { id: 'COMMIT2026', name: 'Commit 2026', percent_off: 20 },
    });
    const { fetchImpl } = makeFetch(subscriptionsResponder(sub));
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const s = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    expect(s.metadata['mrr']).toBeCloseTo(80, 2);
    expect(s.metadata['mrr_gross']).toBeCloseTo(100, 2);
    expect(s.metadata['discount_kind']).toBe('percent');
    expect(s.metadata['discount_value']).toBe(20);
    expect(s.metadata['discount_coupon']).toBe('Commit 2026');
    expect(s.content).toContain('Discount: 20% off (Commit 2026)');
    expect(s.content).toMatch(/MRR: USD 80\.00 \(gross USD 100\.00\)/);
  });

  it('applies an amount_off coupon, normalized to monthly', async () => {
    const sub = subscriptionWith({
      coupon: { id: 'TENOFF', amount_off: 1500, currency: 'usd' },
    });
    const { fetchImpl } = makeFetch(subscriptionsResponder(sub));
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const s = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    // $100 - $15 = $85
    expect(s.metadata['mrr']).toBeCloseTo(85, 2);
    expect(s.metadata['discount_kind']).toBe('amount');
    expect(s.metadata['discount_value']).toBeCloseTo(15, 2);
  });

  it('reads the modern discounts[] array form when discount is absent', async () => {
    const sub = subscriptionWith(undefined, [
      { id: 'di_1', coupon: { id: 'X', percent_off: 10 } },
    ]);
    const { fetchImpl } = makeFetch(subscriptionsResponder(sub));
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const s = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    expect(s.metadata['mrr']).toBeCloseTo(90, 2);
    expect(s.metadata['mrr_gross']).toBeCloseTo(100, 2);
  });

  it('does not adjust MRR or emit discount fields when the coupon is unusable', async () => {
    // Coupon with neither percent_off nor amount_off — Stripe will sometimes
    // surface partial coupons during migration. We must not silently mangle MRR.
    const sub = subscriptionWith({ coupon: { id: 'BROKEN' } });
    const { fetchImpl } = makeFetch(subscriptionsResponder(sub));
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const s = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    expect(s.metadata['mrr']).toBeCloseTo(100, 2);
    expect(s.metadata['mrr_gross']).toBeUndefined();
    expect(s.metadata['discount_kind']).toBeUndefined();
  });

  it('expands data.discount.coupon and data.discounts.coupon in the list call', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      if (routeForUrl(req.url) === 'subscriptions') {
        return jsonResponse({ object: 'list', has_more: false, data: [] });
      }
      return emptyList();
    });
    const spec = createStripeSpec();
    const { stores } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const subCall = calls.find((c) => routeForUrl(c.url) === 'subscriptions')!;
    expect(subCall.url).toContain('expand%5B%5D=data.discount.coupon');
    expect(subCall.url).toContain('expand%5B%5D=data.discounts.coupon');
  });
});

describe('Stripe multi-currency normalization', () => {
  it('emits amount_base + currency_base on records when sources.metadata has fxRates', async () => {
    const { fetchImpl } = makeFetch((req) => {
      const route = routeForUrl(req.url);
      if (route === 'subscriptions') {
        return jsonResponse({
          object: 'list',
          has_more: false,
          data: [
            {
              id: 'sub_eu',
              object: 'subscription',
              created: 1_704_067_200,
              status: 'active',
              customer: 'cus_1',
              livemode: true,
              currency: 'eur',
              items: {
                data: [
                  {
                    id: 'si_1',
                    quantity: 1,
                    price: {
                      id: 'price_eu',
                      unit_amount: 5000, // €50
                      currency: 'eur',
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
              id: 'in_eu',
              object: 'invoice',
              created: 1_704_067_200,
              status: 'paid',
              customer: 'cus_1',
              amount_due: 5000,
              amount_paid: 5000,
              currency: 'eur',
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
              id: 'ch_eu',
              object: 'charge',
              created: 1_704_067_200,
              amount: 5000,
              currency: 'eur',
              status: 'succeeded',
              livemode: true,
            },
          ],
        });
      }
      return emptyList();
    });

    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores({
      sourceMetadata: {
        baseCurrency: 'usd',
        fxRates: { eur: 1.1, usd: 1 },
      },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const sub = enqueued.find((c) => c.kind === 'stripe-subscription')!;
    expect(sub.metadata['mrr']).toBeCloseTo(50, 2);
    expect(sub.metadata['mrr_base']).toBeCloseTo(55, 2);
    expect(sub.metadata['currency_base']).toBe('usd');
    expect(sub.content).toContain('MRR (USD): USD 55.00');

    const inv = enqueued.find((c) => c.kind === 'stripe-invoice')!;
    expect(inv.metadata['amount']).toBeCloseTo(50, 2);
    expect(inv.metadata['amount_base']).toBeCloseTo(55, 2);

    const ch = enqueued.find((c) => c.kind === 'stripe-charge')!;
    expect(ch.metadata['amount_base']).toBeCloseTo(55, 2);
  });

  it('skips the _base fields when no FX rate exists for the record currency', async () => {
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
            amount: 12000,
            currency: 'jpy',
            status: 'succeeded',
            livemode: true,
          },
        ],
      });
    });
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores({
      // baseCurrency set, but no JPY rate — don't silently equate JPY 1 ↔ USD 1.
      sourceMetadata: { baseCurrency: 'usd', fxRates: { eur: 1.1 } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const ch = enqueued.find((c) => c.kind === 'stripe-charge')!;
    expect(ch.metadata['amount_base']).toBeUndefined();
    expect(ch.metadata['currency_base']).toBeUndefined();
  });

  it('ignores partial / malformed fx config', async () => {
    const { fetchImpl } = makeFetch((req) => {
      if (routeForUrl(req.url) !== 'charges') return emptyList();
      return jsonResponse({
        object: 'list',
        has_more: false,
        data: [
          {
            id: 'ch',
            object: 'charge',
            created: 1_704_067_200,
            amount: 1000,
            currency: 'usd',
            status: 'succeeded',
            livemode: true,
          },
        ],
      });
    });
    const spec = createStripeSpec();
    const { stores, enqueued } = makeStores({
      // Missing baseCurrency — must NOT emit _base fields.
      sourceMetadata: { fxRates: { usd: 1 } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    const ch = enqueued.find((c) => c.kind === 'stripe-charge')!;
    expect(ch.metadata['amount_base']).toBeUndefined();
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
