/**
 * Resolver unit tests. The DB layer is mocked via a tagged-template stand-in
 * so we can assert on what queries were issued and what each row in the
 * batch resolved to without spinning up Postgres. Integration coverage
 * (real upsert/lookup against migrations) lives in the retrieval-core
 * roundtrip suite.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  CUSTOMER_ACCOUNT_HINT_KEY,
  CUSTOMER_ACCOUNT_UPSERT_KEY,
  resolveCustomerAccountsForBatch,
  stripCustomerAccountHints,
  type CustomerAccountResolveHint,
  type CustomerAccountUpsertHint,
} from '../src/shared/customer-accounts';

const ORG = '00000000-0000-0000-0000-000000000001';
const HUBSPOT_ROW_ID = '11111111-1111-1111-1111-111111111111';
const SALESFORCE_ROW_ID = '22222222-2222-2222-2222-222222222222';

describe('stripCustomerAccountHints', () => {
  it('returns the same object when no hints are present', () => {
    const meta = { foo: 'bar', record_type: 'company' };
    const stripped = stripCustomerAccountHints(meta);
    expect(stripped).toBe(meta);
  });

  it('removes both hint keys but preserves the rest', () => {
    const meta = {
      foo: 'bar',
      [CUSTOMER_ACCOUNT_UPSERT_KEY]: { source: 'hubspot', externalId: '1', displayName: 'X' },
      [CUSTOMER_ACCOUNT_HINT_KEY]: { domain: 'example.com' },
    };
    const stripped = stripCustomerAccountHints(meta);
    expect(stripped).toEqual({ foo: 'bar' });
    expect(stripped).not.toBe(meta);
    expect(meta[CUSTOMER_ACCOUNT_UPSERT_KEY]).toBeDefined();
  });

  it('returns {} for null/undefined input', () => {
    expect(stripCustomerAccountHints(null)).toEqual({});
    expect(stripCustomerAccountHints(undefined)).toEqual({});
  });
});

describe('resolveCustomerAccountsForBatch', () => {
  it('returns [] for an empty batch without touching SQL', async () => {
    const sql = vi.fn();
    const out = await resolveCustomerAccountsForBatch(sql as never, []);
    expect(out).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
  });

  it('upserts and stamps for canonical-source chunks', async () => {
    const upsert: CustomerAccountUpsertHint = {
      source: 'hubspot',
      externalId: 'hs-123',
      displayName: 'Skello',
      primaryDomain: 'skello.io',
    };
    const sql = mockSql([
      // First call: INSERT ... ON CONFLICT (returns nothing useful — we
      // don't check it here).
      { rows: [] },
      // Second call: SELECT id, organization_id, hubspot_company_id FROM ...
      { rows: [{ id: HUBSPOT_ROW_ID, org: ORG, ext: 'hs-123' }] },
    ]);
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_UPSERT_KEY]: upsert } },
    ]);
    expect(out).toEqual([{ accountId: HUBSPOT_ROW_ID }]);
    expect(sql.calls.length).toBe(2);
  });

  it('looks up existing rows for resolve hints', async () => {
    const hint: CustomerAccountResolveHint = { hubspotCompanyId: 'hs-123' };
    const sql = mockSql([
      // Only the hubspot-id lookup fires. No domain/salesforce/pylon
      // lookups because the hint doesn't carry those.
      { rows: [{ id: HUBSPOT_ROW_ID, hubspot_company_id: 'hs-123' }] },
    ]);
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_HINT_KEY]: hint } },
    ]);
    expect(out).toEqual([{ accountId: HUBSPOT_ROW_ID }]);
    expect(sql.calls.length).toBe(1);
  });

  it('returns null accountId when a resolve hint has no match', async () => {
    const hint: CustomerAccountResolveHint = { domain: 'unknown.com' };
    const sql = mockSql([{ rows: [] }]); // domain lookup misses
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_HINT_KEY]: hint } },
    ]);
    expect(out).toEqual([{ accountId: null }]);
  });

  it('returns null for chunks with no hints, without lookup', async () => {
    const sql = mockSql([]);
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { kind: 'github-pr', title: 'fix bug' } },
    ]);
    expect(out).toEqual([{ accountId: null }]);
    expect(sql.calls.length).toBe(0);
  });

  it('mixed batch: upsert + resolve + no-hint, one mapping per row', async () => {
    const sql = mockSql([
      // 1. hubspot upsert INSERT
      { rows: [] },
      // 2. hubspot upsert id-roundtrip SELECT
      { rows: [{ id: HUBSPOT_ROW_ID, org: ORG, ext: 'hs-123' }] },
      // 3. salesforce-id lookup for the resolve-hint row
      { rows: [{ id: SALESFORCE_ROW_ID, salesforce_account_id: 'sf-555' }] },
    ]);

    const rows = [
      // Row 0: upsert hint → stamped with HUBSPOT_ROW_ID
      {
        organizationId: ORG,
        metadata: {
          [CUSTOMER_ACCOUNT_UPSERT_KEY]: {
            source: 'hubspot',
            externalId: 'hs-123',
            displayName: 'Skello',
          },
        },
      },
      // Row 1: resolve hint via salesforce id → stamped with SALESFORCE_ROW_ID
      {
        organizationId: ORG,
        metadata: { [CUSTOMER_ACCOUNT_HINT_KEY]: { salesforceAccountId: 'sf-555' } },
      },
      // Row 2: no hint → null
      { organizationId: ORG, metadata: { unrelated: 'data' } },
    ];

    const out = await resolveCustomerAccountsForBatch(sql.fn, rows);
    expect(out).toEqual([
      { accountId: HUBSPOT_ROW_ID },
      { accountId: SALESFORCE_ROW_ID },
      { accountId: null },
    ]);
  });

  it('dedupes identical upserts in a batch (one SQL call per (org, source, externalId))', async () => {
    const sql = mockSql([
      { rows: [] }, // INSERT
      { rows: [{ id: HUBSPOT_ROW_ID, org: ORG, ext: 'hs-123' }] }, // roundtrip
    ]);
    const upsert: CustomerAccountUpsertHint = {
      source: 'hubspot',
      externalId: 'hs-123',
      displayName: 'Skello',
    };
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_UPSERT_KEY]: upsert } },
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_UPSERT_KEY]: upsert } },
    ]);
    expect(out).toEqual([{ accountId: HUBSPOT_ROW_ID }, { accountId: HUBSPOT_ROW_ID }]);
    // Just two SQL calls — the INSERT and the roundtrip SELECT — for two
    // chunks sharing the same upsert tuple.
    expect(sql.calls.length).toBe(2);
  });

  it('ignores malformed hints (missing required fields)', async () => {
    const sql = mockSql([]);
    const out = await resolveCustomerAccountsForBatch(sql.fn, [
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_UPSERT_KEY]: { source: 'hubspot' } } },
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_HINT_KEY]: {} } },
      { organizationId: ORG, metadata: { [CUSTOMER_ACCOUNT_UPSERT_KEY]: 'not-an-object' } },
    ]);
    expect(out).toEqual([{ accountId: null }, { accountId: null }, { accountId: null }]);
    expect(sql.calls.length).toBe(0);
  });
});

/**
 * Minimal tagged-template stub: each call returns the next canned response.
 * Postgres-js's `sql` is both callable as a template AND as a function (for
 * the `sql(rows, ...cols)` helper) AND exposes `sql.unsafe(str)`. We model
 * the template invocation since that's what the resolver does end-to-end;
 * `sql(...)` and `sql.unsafe(...)` just return placeholder objects that get
 * interpolated into the template (the contents don't matter to the stub).
 */
interface SqlCall {
  /** The cooked strings as a single concatenated string for grep-style asserts. */
  text: string;
}

function mockSql(responses: ReadonlyArray<{ rows: unknown[] }>) {
  const calls: SqlCall[] = [];
  let idx = 0;
  // postgres-js's `sql` is a callable that branches on the first argument:
  // a TemplateStringsArray means "run a query"; anything else means
  // "produce a SQL fragment for interpolation" (e.g. `sql(rows, ...cols)`).
  // Only the query path consumes a canned response; the fragment path
  // returns a sentinel that other interpolations stringify fine.
  const tagFn = (firstArg: unknown, ..._rest: unknown[]) => {
    const isTemplate =
      Array.isArray(firstArg)
      && Object.prototype.hasOwnProperty.call(firstArg, 'raw');
    if (!isTemplate) {
      return { fragment: true };
    }
    const strings = firstArg as TemplateStringsArray;
    calls.push({ text: strings.join('?') });
    const response = responses[idx++];
    return Promise.resolve(response?.rows ?? []);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = tagFn as any;
  fn.unsafe = (s: string) => ({ unsafe: s });
  return { fn, calls };
}
