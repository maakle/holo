/**
 * Regression test for the path-backfill bulk UPDATE. The original
 * implementation used `UNNEST(..., ${aclArrays}::text[][])`, which Postgres
 * flattens to scalar text, causing `acl_subjects` (a text[] column) to
 * reject the assignment. The fix is `jsonb_to_recordset(${sql.json(...)})`
 * which lets each row carry its own jagged ACL array.
 *
 * This test pins both halves of the contract: the JSON payload shape and
 * the SQL template the runner emits.
 */
import { describe, it, expect } from 'vitest';
import { runPathBackfill } from '../src/queues/path-backfill';

interface SqlCall {
  text: string;
  values: unknown[];
}

interface FakeSql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sql: any;
  calls: SqlCall[];
  queueResult: (rows: unknown[]) => void;
}

/**
 * Minimal postgres-js stand-in. Supports the three call shapes the
 * backfill uses: tagged template, helper-call (sql(arrayForInClause)),
 * and sql.json(v). Returns canned results from a FIFO queue.
 */
function makeFakeSql(): FakeSql {
  const calls: SqlCall[] = [];
  const queue: unknown[][] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = (
    templateOrArg: TemplateStringsArray | unknown,
    ...values: unknown[]
  ) => {
    if (Array.isArray(templateOrArg) && 'raw' in (templateOrArg as object)) {
      // Tagged template literal.
      const template = templateOrArg as unknown as TemplateStringsArray;
      const text = template.join('?');
      calls.push({ text, values });
      const result = queue.shift() ?? [];
      return Promise.resolve(result);
    }
    // sql(value) callable form — used for IN(...) and bulk-row helpers.
    return { __helper: templateOrArg };
  };
  sql.json = (v: unknown) => ({ __json: v });
  sql.array = (v: unknown) => ({ __array: v });

  return {
    sql,
    calls,
    queueResult: (rows) => queue.push(rows),
  };
}

describe('runPathBackfill', () => {
  it('emits jsonb_to_recordset with one record per artifact (jagged ACL arrays preserved)', async () => {
    const fake = makeFakeSql();
    // Two artifacts, both kinds with registered path-fns (`stripe-charge`
    // gets `/stripe/charges/<id>.md`). One artifact has 3 ACL subjects,
    // the other has 1 — the original UNNEST bug surfaced precisely on
    // this jagged-array case.
    fake.queueResult([
      {
        id: '00000000-0000-0000-0000-000000000001',
        organization_id: 'org-1',
        kind: 'stripe-charge',
        external_id: 'ch_aaa',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        organization_id: 'org-1',
        kind: 'stripe-charge',
        external_id: 'ch_bbb',
      },
    ]);
    // chunks SELECT result — one row per artifact.
    fake.queueResult([
      {
        source_artifact_id: '00000000-0000-0000-0000-000000000001',
        metadata: {},
        acl_subjects: ['org:org-1', 'user:alice', 'group:eng'],
      },
      {
        source_artifact_id: '00000000-0000-0000-0000-000000000002',
        metadata: {},
        acl_subjects: ['org:org-1'],
      },
    ]);
    // UPDATE returns nothing meaningful.
    fake.queueResult([]);
    // Next-iteration SELECT returns empty, exits the loop.
    fake.queueResult([]);

    const result = await runPathBackfill(fake.sql, { batchSize: 100 });

    expect(result.totalScanned).toBe(2);
    expect(result.totalFilled).toBe(2);
    expect(result.totalSkippedUnknownKind).toBe(0);
    expect(result.totalSkippedBadMetadata).toBe(0);

    // 3rd SQL call is the bulk UPDATE.
    const updateCall = fake.calls[2];
    expect(updateCall).toBeDefined();
    expect(updateCall!.text).toMatch(/UPDATE source_artifacts/);
    // Pin the fix: regression to UNNEST(..., text[][]) would not pass
    // through jsonb_to_recordset.
    expect(updateCall!.text).toMatch(/jsonb_to_recordset/);
    expect(updateCall!.text).not.toMatch(/UNNEST/);
    // The first (and only) bind value is the sql.json(payload) wrapper.
    expect(updateCall!.values).toHaveLength(1);
    const jsonArg = updateCall!.values[0] as { __json: unknown };
    expect(jsonArg.__json).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000001',
        path: '/stripe/charges/ch_aaa.md',
        acl_subjects: ['org:org-1', 'user:alice', 'group:eng'],
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        path: '/stripe/charges/ch_bbb.md',
        acl_subjects: ['org:org-1'],
      },
    ]);
  });

  it('skips kinds without a registered path-fn and reports them', async () => {
    const fake = makeFakeSql();
    fake.queueResult([
      {
        id: '00000000-0000-0000-0000-000000000003',
        organization_id: 'org-1',
        kind: 'made-up-kind',
        external_id: 'x-1',
      },
    ]);
    fake.queueResult([]);

    const result = await runPathBackfill(fake.sql, { batchSize: 100 });

    expect(result.totalScanned).toBe(1);
    expect(result.totalFilled).toBe(0);
    expect(result.totalSkippedUnknownKind).toBe(1);
    expect(result.unknownKinds).toEqual({ 'made-up-kind': 1 });
    // No UPDATE should fire when nothing fills — the runner returned
    // after exactly the two SELECTs.
    expect(fake.calls.length).toBe(2);
  });

  it('repair mode rewrites rows whose stored path disagrees with path-fn', async () => {
    const fake = makeFakeSql();
    // Two airtable-record rows. The first has a stale path (the literal
    // form produced before the camelCase fix in commit e5ce89e); the
    // second is already correct and must NOT be UPDATEd.
    fake.queueResult([
      {
        id: '00000000-0000-0000-0000-000000000010',
        organization_id: 'org-1',
        kind: 'airtable-record',
        external_id: 'airtable-record:appA:tblA:recA',
        path: '/airtable/base/table/airtable-record:appA:tblA:recA.md',
      },
      {
        id: '00000000-0000-0000-0000-000000000011',
        organization_id: 'org-1',
        kind: 'airtable-record',
        external_id: 'airtable-record:appA:tblA:recB',
        path: '/airtable/marketing/leads/recB.md',
      },
    ]);
    fake.queueResult([
      {
        source_artifact_id: '00000000-0000-0000-0000-000000000010',
        metadata: { baseName: 'Marketing', tableName: 'Leads', recordId: 'recA' },
        acl_subjects: ['org:org-1'],
      },
      {
        source_artifact_id: '00000000-0000-0000-0000-000000000011',
        metadata: { baseName: 'Marketing', tableName: 'Leads', recordId: 'recB' },
        acl_subjects: ['org:org-1'],
      },
    ]);
    fake.queueResult([]); // bulk UPDATE
    fake.queueResult([]); // next-iteration SELECT (empty → exit)

    const result = await runPathBackfill(fake.sql, { batchSize: 100, repair: true });

    expect(result.totalScanned).toBe(2);
    expect(result.totalFilled).toBe(1);
    expect(result.totalUnchanged).toBe(1);
    expect(result.totalSkippedUnknownKind).toBe(0);

    // First call selects with the repair filter.
    expect(fake.calls[0]!.text).toMatch(/path IS NOT NULL/);
    // Bulk UPDATE only carries the one row that actually changed.
    const updateCall = fake.calls[2];
    expect(updateCall!.text).toMatch(/UPDATE source_artifacts/);
    const jsonArg = updateCall!.values[0] as { __json: unknown };
    expect(jsonArg.__json).toEqual([
      {
        id: '00000000-0000-0000-0000-000000000010',
        path: '/airtable/marketing/leads/recA.md',
        acl_subjects: ['org:org-1'],
      },
    ]);
  });
});
