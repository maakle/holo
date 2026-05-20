import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Stripe SDK pulls in a lot at import time; mock the client module so the
// test file doesn't hit the env-var assertion before we can stub it.
vi.mock('../src/client', async () => {
  const stripe = {
    webhooks: {
      constructEvent: vi.fn((rawBody: string, sig: string) => {
        if (sig === 'invalid') throw new Error('bad signature');
        return JSON.parse(rawBody);
      }),
    },
    subscriptions: {
      retrieve: vi.fn(),
    },
  };
  return {
    getStripeClient: () => stripe,
    resetStripeClient: () => {},
    __mockStripe: stripe,
  };
});

vi.mock('../src/env', () => ({
  readStripeEnv: () => ({
    secretKey: 'sk_test_x',
    webhookSecret: 'whsec_x',
    publishableKey: 'pk_test_x',
  }),
}));

import { verifyStripeSignature, handleStripeEvent } from '../src/webhooks';

describe('verifyStripeSignature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a valid event', () => {
    const event = verifyStripeSignature({
      rawBody: JSON.stringify({ id: 'evt_1', type: 'customer.created' }),
      signature: 'valid',
    });
    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('customer.created');
  });

  it('throws a HoloError on bad signature', () => {
    expect(() =>
      verifyStripeSignature({ rawBody: '{}', signature: 'invalid' }),
    ).toThrow(/signature verification failed/);
  });
});

/**
 * Stub Drizzle DB whose insert/update chains let us track what
 * handleStripeEvent records into `stripe_webhook_events`.
 */
function stubDb(opts: {
  onWebhookInsert?: (id: string) => 'inserted' | 'duplicate';
}) {
  let lastWebhookInsertId: string | null = null;
  const writes: Array<{ table: string; op: string; values?: unknown }> = [];

  const dbAny: any = {
    insert: vi.fn((table: { _: { name: string } }) => {
      const tableName = (table as unknown as { [k: string]: unknown })[
        Symbol.for('drizzle:Name') as unknown as string
      ] as string | undefined;
      return {
        values: (vals: any) => {
          if (tableName === 'stripe_webhook_events' || vals.id?.startsWith?.('evt_')) {
            lastWebhookInsertId = vals.id;
          }
          writes.push({ table: tableName ?? 'unknown', op: 'insert', values: vals });
          return {
            onConflictDoNothing: () => ({
              returning: async () => {
                const result =
                  opts.onWebhookInsert?.(lastWebhookInsertId ?? '') ?? 'inserted';
                return result === 'inserted' ? [{ id: lastWebhookInsertId }] : [];
              },
            }),
          };
        },
      };
    }),
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        writes.push({ table: 'unknown', op: 'update', values: vals });
        return {
          where: async () => undefined,
        };
      },
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    })),
  };
  return { db: dbAny, writes };
}

describe('handleStripeEvent — idempotency', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('inserts on first delivery and dispatches', async () => {
    const { db } = stubDb({ onWebhookInsert: () => 'inserted' });
    const event = {
      id: 'evt_abc',
      type: 'invoice.payment_failed',
      data: { object: { parent: null } },
    } as any;
    await handleStripeEvent(db, event);
    // Insert into stripe_webhook_events ran; no further work because invoice
    // had no subscription reference.
    expect(db.insert).toHaveBeenCalled();
  });

  it('no-ops on duplicate delivery', async () => {
    const { db, writes } = stubDb({ onWebhookInsert: () => 'duplicate' });
    const event = {
      id: 'evt_abc',
      type: 'invoice.payment_failed',
      data: { object: { parent: null } },
    } as any;
    await handleStripeEvent(db, event);
    // After the dedupe insert returned empty, no follow-up writes happen.
    const followUp = writes.filter((w) => w.op !== 'insert');
    expect(followUp).toHaveLength(0);
  });
});
