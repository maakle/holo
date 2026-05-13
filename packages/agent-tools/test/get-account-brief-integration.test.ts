/**
 * `get_account_brief` — DB-backed integration tests for the cache + ACL
 * paths. Skipped unless `DATABASE_URL` points at a live Postgres with the
 * schema migrated; the suite seeds and cleans up its own (org, account,
 * chunk) rows. The flow this file pins down:
 *
 *   1. Tool returns the five-section structure on a seeded account.
 *   2. Cache write happens after synthesis; same-day re-read returns the
 *      cached payload with `fromCache: true`.
 *   3. `invalidateAccountBriefCache` drops the row and the next call
 *      re-synthesizes.
 *   4. A user without subjects matching the account's chunks gets an
 *      empty (atGlance.displayName === '') payload — which the REST/web
 *      layer maps to 403.
 *
 * These are the behaviours the RFC pins as gates, in addition to the pure
 * unit tests in `get-account-brief.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DB } from '@holo/db';
import {
  runGetAccountBriefTool,
  invalidateAccountBriefCache,
  type AccountBrief,
} from '../src';

const url = process.env.DATABASE_URL ?? '';
let dbReachable = false;
const TEST_SLUG = 'test-account-brief';

let db: DB;
let orgId: string;

beforeAll(async () => {
  if (!url) return;
  try {
    db = createDb(url);
    const orgRes = await db.execute<{ id: string }>(sql`
      INSERT INTO organization (slug, name) VALUES (${TEST_SLUG}, 'brief test org')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    orgId = ((orgRes as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (orgRes as unknown as Array<{ id: string }>))[0]!.id;
    dbReachable = true;
  } catch {
    // Postgres not running / migrations not applied — skip the suite.
    // Pure unit tests in `get-account-brief.test.ts` still pin the schema.
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  await db.execute(sql`DELETE FROM organization WHERE slug = ${TEST_SLUG}`);
});

async function cleanState(): Promise<void> {
  // Cascades clear account_brief_cache, chunks, customer_accounts via FK.
  await db.execute(sql`DELETE FROM customer_accounts WHERE organization_id = ${orgId}`);
  await db.execute(sql`DELETE FROM sources WHERE organization_id = ${orgId}`);
}

afterEach(async () => {
  if (!dbReachable) return;
  await cleanState();
});

async function seedAccount(displayName: string): Promise<string> {
  const res = await db.execute<{ id: string }>(sql`
    INSERT INTO customer_accounts (organization_id, display_name, tier, owner_email, arr_amount, arr_currency)
    VALUES (${orgId}, ${displayName}, 'T1', 'owner@holo.example', 50000, 'USD')
    RETURNING id
  `);
  return ((res as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (res as unknown as Array<{ id: string }>))[0]!.id;
}

describe('get_account_brief — DB integration', () => {
  // We use the fixed `today` injection so the cache_day in the test is
  // deterministic regardless of when the suite runs.
  const FROZEN_TODAY = '2026-05-13';
  const today = () => FROZEN_TODAY;

  it('returns the five-section structure on a seeded account', async () => {
    if (!dbReachable) return;
    const accountId = await seedAccount('Skello');
    const brief = await runGetAccountBriefTool(
      {
        db,
        organizationId: orgId,
        userSubjects: [`org:${orgId}`],
        today,
      },
      { account_id: accountId, context: 'check-in' },
    );

    expect(brief.accountId).toBe(accountId);
    expect(brief.context).toBe('check-in');
    expect(brief.fromCache).toBe(false);
    expect(brief.sections.atGlance.displayName).toBe('Skello');
    expect(brief.sections.atGlance.tier).toBe('T1');
    expect(brief.sections.atGlance.owner).toBe('owner@holo.example');
    expect(brief.sections.atGlance.arr).toEqual({ amount: '50000.00', currency: 'USD' });

    // All five sections always present even when there's no data — the empty
    // ones still carry the freshness envelope so chips render uniformly.
    expect(brief.sections.issues).toBeDefined();
    expect(brief.sections.lastConversation).toBeDefined();
    expect(brief.sections.productAsks).toBeDefined();
    expect(brief.sections.contextSection).toBeDefined();
  });

  it('writes to cache after synthesis; same-day read returns fromCache=true', async () => {
    if (!dbReachable) return;
    const accountId = await seedAccount('CacheTest');
    const fresh = await runGetAccountBriefTool(
      {
        db,
        organizationId: orgId,
        userSubjects: [`org:${orgId}`],
        today,
      },
      { account_id: accountId, context: 'renewal' },
    );
    expect(fresh.fromCache).toBe(false);

    // Verify the row landed in account_brief_cache before the re-read.
    const rows = await db.execute<{ c: number }>(sql`
      SELECT COUNT(*)::int AS c FROM account_brief_cache
      WHERE organization_id = ${orgId}
        AND account_id = ${accountId}
        AND context = 'renewal'
        AND cache_day = ${FROZEN_TODAY}
    `);
    const count = ((rows as unknown as { rows?: Array<{ c: number }> }).rows
      ?? (rows as unknown as Array<{ c: number }>))[0]!.c;
    expect(count).toBe(1);

    const second = await runGetAccountBriefTool(
      {
        db,
        organizationId: orgId,
        userSubjects: [`org:${orgId}`],
        today,
      },
      { account_id: accountId, context: 'renewal' },
    );
    expect(second.fromCache).toBe(true);
    // Cached payload preserves the same generatedAt as the original write.
    expect(second.generatedAt).toBe(fresh.generatedAt);
  });

  it('invalidateAccountBriefCache drops the row and forces re-synthesis', async () => {
    if (!dbReachable) return;
    const accountId = await seedAccount('Regenerate');
    const first = await runGetAccountBriefTool(
      { db, organizationId: orgId, userSubjects: [`org:${orgId}`], today },
      { account_id: accountId, context: 'upsell' },
    );
    expect(first.fromCache).toBe(false);

    // Confirm the cache hit shortcircuits before regenerate.
    const cached = await runGetAccountBriefTool(
      { db, organizationId: orgId, userSubjects: [`org:${orgId}`], today },
      { account_id: accountId, context: 'upsell' },
    );
    expect(cached.fromCache).toBe(true);

    await invalidateAccountBriefCache({
      db,
      organizationId: orgId,
      accountId,
      context: 'upsell',
      today,
    });

    const regen = await runGetAccountBriefTool(
      { db, organizationId: orgId, userSubjects: [`org:${orgId}`], today },
      { account_id: accountId, context: 'upsell' },
    );
    expect(regen.fromCache).toBe(false);
  });

  it('returns an empty brief (atGlance.displayName === "") when the account is in a different org', async () => {
    if (!dbReachable) return;
    // ACL gate: the tool only finds accounts inside ctx.organizationId.
    // A UUID belonging to a different org returns the empty shape, which
    // REST/web translate into 403.
    const otherOrgRes = await db.execute<{ id: string }>(sql`
      INSERT INTO organization (slug, name) VALUES (${TEST_SLUG + '-other'}, 'other org')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const otherOrgId = ((otherOrgRes as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (otherOrgRes as unknown as Array<{ id: string }>))[0]!.id;
    try {
      const otherAccount = await db.execute<{ id: string }>(sql`
        INSERT INTO customer_accounts (organization_id, display_name)
        VALUES (${otherOrgId}, 'Stranger Co')
        RETURNING id
      `);
      const otherAccountId = ((otherAccount as unknown as { rows?: Array<{ id: string }> }).rows
        ?? (otherAccount as unknown as Array<{ id: string }>))[0]!.id;

      const brief: AccountBrief = await runGetAccountBriefTool(
        {
          db,
          organizationId: orgId, // our org, not otherOrgId
          userSubjects: [`org:${orgId}`],
          today,
        },
        { account_id: otherAccountId, context: 'check-in' },
      );
      expect(brief.sections.atGlance.displayName).toBe('');
    } finally {
      await db.execute(sql`DELETE FROM organization WHERE slug = ${TEST_SLUG + '-other'}`);
    }
  });
});

// Sanity: this suite is empty-but-passing when no DB is reachable. The
// pure-unit suite in `get-account-brief.test.ts` still runs and pins the
// schema, prompt presets, and section ordering.
