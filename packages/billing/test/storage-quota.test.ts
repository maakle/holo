import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@holo/db';
import { resetBillingEnabledCache } from '../src/env';

// Mock plan lookup + the Drizzle chain that counts chunks. We never touch a
// real DB; the mocks drive every branch of checkStorageQuota.
vi.mock('../src/plans', async () => {
  const actual = await vi.importActual<typeof import('../src/plans')>('../src/plans');
  return { ...actual, getCurrentSubscription: vi.fn() };
});

const { getCurrentSubscription } = await import('../src/plans');
const { checkStorageQuota } = await import('../src/limits');

const orgId = '00000000-0000-0000-0000-000000000001';

/**
 * Make a stub `DB` whose only used method is `.select(...).from(...).where(...)`,
 * returning a single row `[{ count: '<n>' }]`. Matches the shape `checkStorageQuota`
 * builds for the chunk count.
 */
function makeDb(currentCount: number): DB {
  const builder = {
    from: () => builder,
    where: async () => [{ count: String(currentCount) }],
  };
  return { select: () => builder } as unknown as DB;
}

function mockPlan(slug: 'free' | 'starter' | 'team' | 'enterprise', maxStoredChunks: number | null | undefined) {
  (getCurrentSubscription as ReturnType<typeof vi.fn>).mockResolvedValue({
    organizationId: orgId,
    status: 'active',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    plan: {
      id: 'plan-id',
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
      monthlyCredits: 0,
      monthlyPriceCents: 0,
      features: {
        maxConnectors: null,
        maxStoredChunks,
      },
      isPublic: true,
    },
  });
}

describe('checkStorageQuota (billing PR 3)', () => {
  beforeEach(() => {
    process.env.HOLO_BILLING_ENABLED = 'true';
    resetBillingEnabledCache();
    (getCurrentSubscription as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    delete process.env.HOLO_BILLING_ENABLED;
    resetBillingEnabledCache();
  });

  it('allows when count < limit', async () => {
    mockPlan('starter', 100_000);
    const decision = await checkStorageQuota(makeDb(50_000), orgId);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.currentCount).toBe(50_000);
      expect(decision.limit).toBe(100_000);
    }
  });

  it('allows when count + delta == limit (boundary inclusive)', async () => {
    mockPlan('starter', 100_000);
    const decision = await checkStorageQuota(makeDb(99_500), orgId, 500);
    expect(decision.allowed).toBe(true);
  });

  it('blocks when count + delta > limit', async () => {
    mockPlan('starter', 100_000);
    const decision = await checkStorageQuota(makeDb(99_500), orgId, 501);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('storage_cap');
      expect(decision.currentCount).toBe(99_500);
      expect(decision.limit).toBe(100_000);
      expect(decision.suggestedUpgradeSlug).toBe('team');
    }
  });

  it('blocks when already over cap (deltaCount=0)', async () => {
    mockPlan('free', 25_000);
    const decision = await checkStorageQuota(makeDb(30_000), orgId);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.suggestedUpgradeSlug).toBe('starter');
    }
  });

  it('allows unlimited plans (limit = null)', async () => {
    mockPlan('enterprise', null);
    const decision = await checkStorageQuota(makeDb(10_000_000), orgId, 5000);
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.limit).toBe(null);
    }
  });

  it('allows when feature key is undefined (legacy plan rows pre-migration)', async () => {
    mockPlan('team', undefined);
    const decision = await checkStorageQuota(makeDb(100_000), orgId, 1000);
    expect(decision.allowed).toBe(true);
  });

  it('short-circuits when billing is disabled (CE bypass)', async () => {
    delete process.env.HOLO_BILLING_ENABLED;
    resetBillingEnabledCache();
    // getCurrentSubscription should NOT be called.
    mockPlan('free', 25_000);
    const decision = await checkStorageQuota(makeDb(1_000_000), orgId);
    expect(decision.allowed).toBe(true);
    expect((getCurrentSubscription as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('allows when no subscription exists', async () => {
    (getCurrentSubscription as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const decision = await checkStorageQuota(makeDb(5_000), orgId);
    expect(decision.allowed).toBe(true);
  });

  it('suggests business when team is full', async () => {
    mockPlan('team', 500_000);
    const decision = await checkStorageQuota(makeDb(500_001), orgId);
    if (decision.allowed) throw new Error('expected blocked');
    expect(decision.suggestedUpgradeSlug).toBe('business');
  });
});
