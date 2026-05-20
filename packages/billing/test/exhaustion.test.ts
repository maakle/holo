import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DB } from '@holo/db';
import { resetBillingEnabledCache } from '../src/env';

// Mock the ledger so we can drive getOrgBalance without a real DB.
vi.mock('../src/ledger', async () => {
  const actual = await vi.importActual<typeof import('../src/ledger')>('../src/ledger');
  return {
    ...actual,
    getOrgBalance: vi.fn(),
  };
});

// Imported AFTER vi.mock so the mocked module is what limits.ts sees.
const { getOrgBalance } = await import('../src/ledger');
const { checkCreditPool, assertSufficientCredits } = await import('../src/limits');

// A `DB` stub — we never touch it because getOrgBalance is mocked.
const db = {} as DB;
const orgId = '00000000-0000-0000-0000-000000000001';

function setBalance(balance: number) {
  (getOrgBalance as ReturnType<typeof vi.fn>).mockResolvedValue({
    balance,
    debitsTotal: 0,
    grantsTotal: balance > 0 ? balance : 0,
  });
}

describe('credit pool exhaustion guard (RFC 0010 / ADR 0007)', () => {
  beforeEach(() => {
    process.env.HOLO_BILLING_ENABLED = 'true';
    resetBillingEnabledCache();
    (getOrgBalance as ReturnType<typeof vi.fn>).mockReset();
  });

  afterEach(() => {
    delete process.env.HOLO_BILLING_ENABLED;
    resetBillingEnabledCache();
  });

  describe('checkCreditPool', () => {
    it('allows when balance > 0', async () => {
      setBalance(150);
      const decision = await checkCreditPool(db, orgId);
      expect(decision.allowed).toBe(true);
      expect(decision.balance).toBe(150);
    });

    it('blocks when balance == 0', async () => {
      setBalance(0);
      const decision = await checkCreditPool(db, orgId);
      expect(decision.allowed).toBe(false);
      expect(decision.balance).toBe(0);
    });

    it('blocks when balance is negative (e.g. final debit pushed below zero)', async () => {
      setBalance(-50);
      const decision = await checkCreditPool(db, orgId);
      expect(decision.allowed).toBe(false);
      expect(decision.balance).toBe(-50);
    });

    it('short-circuits to allowed when billing is disabled', async () => {
      process.env.HOLO_BILLING_ENABLED = 'false';
      resetBillingEnabledCache();
      const decision = await checkCreditPool(db, orgId);
      expect(decision.allowed).toBe(true);
      expect(getOrgBalance).not.toHaveBeenCalled();
    });
  });

  describe('assertSufficientCredits', () => {
    it('returns silently when balance > 0', async () => {
      setBalance(150);
      await expect(assertSufficientCredits(db, orgId)).resolves.toBeUndefined();
    });

    it('throws HOLO_CREDIT_POOL_EXHAUSTED when balance == 0', async () => {
      setBalance(0);
      await expect(assertSufficientCredits(db, orgId)).rejects.toMatchObject({
        code: 'HOLO_CREDIT_POOL_EXHAUSTED',
      });
    });

    it('throws HOLO_CREDIT_POOL_EXHAUSTED when balance is negative', async () => {
      setBalance(-1);
      await expect(assertSufficientCredits(db, orgId)).rejects.toMatchObject({
        code: 'HOLO_CREDIT_POOL_EXHAUSTED',
      });
    });

    it('includes an actionable fix message pointing at the top-up flow', async () => {
      setBalance(0);
      try {
        await assertSufficientCredits(db, orgId);
        throw new Error('expected to throw');
      } catch (err) {
        expect((err as { fix: string }).fix).toMatch(/top-up|upgrade/i);
      }
    });

    it('returns silently when billing is disabled, even with a zero balance', async () => {
      process.env.HOLO_BILLING_ENABLED = 'false';
      resetBillingEnabledCache();
      await expect(assertSufficientCredits(db, orgId)).resolves.toBeUndefined();
    });
  });
});
