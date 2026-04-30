import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { resolveAllowlist } from '../../src/shared/allowlist';
import {
  makeTestDb,
  ensureTestOrgAndUser,
  seedAllowlistRows,
  cleanAllowlistRows,
} from '../helpers/db';
import type { DB } from '@holo/db';

const PROVIDER = 'github' as const;

describe('resolveAllowlist', () => {
  let db: DB;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    db = makeTestDb();
    ({ orgId, userId } = await ensureTestOrgAndUser(db));
  });

  afterEach(async () => {
    await cleanAllowlistRows(db, orgId, PROVIDER);
  });

  afterAll(async () => {
    // Final sweep in case a test crashed mid-run before afterEach fired.
    await cleanAllowlistRows(db, orgId, PROVIDER);
  });

  it('(a) glob include only — matches included pattern, rejects non-matching', async () => {
    await seedAllowlistRows(db, orgId, userId, PROVIDER, [
      { pattern: 'acme/*', patternKind: 'glob', decision: 'include' },
    ]);

    const result = await resolveAllowlist({
      db,
      organizationId: orgId,
      provider: PROVIDER,
      candidates: ['acme/api', 'other/api'],
    });

    expect(result.resolved).toEqual(['acme/api']);
    expect(result.matches('acme/api')).toBe(true);
    expect(result.matches('other/api')).toBe(false);
  });

  it('(b) include + exclude — exclude wins on overlap (acme/secret-* excluded from acme/* include)', async () => {
    await seedAllowlistRows(db, orgId, userId, PROVIDER, [
      { pattern: 'acme/*', patternKind: 'glob', decision: 'include' },
      { pattern: 'acme/secret-*', patternKind: 'glob', decision: 'exclude' },
    ]);

    const result = await resolveAllowlist({
      db,
      organizationId: orgId,
      provider: PROVIDER,
      candidates: ['acme/api', 'acme/secret-repo', 'acme/secret-infra', 'other/api'],
    });

    expect(result.resolved).toEqual(['acme/api']);
    expect(result.matches('acme/api')).toBe(true);
    expect(result.matches('acme/secret-repo')).toBe(false);
    expect(result.matches('other/api')).toBe(false);
  });

  it('(c) exact_id match — matches itself, rejects different id', async () => {
    await seedAllowlistRows(db, orgId, userId, PROVIDER, [
      { pattern: 'C0123456789', patternKind: 'exact_id', decision: 'include' },
    ]);

    const result = await resolveAllowlist({
      db,
      organizationId: orgId,
      provider: PROVIDER,
      candidates: ['C0123456789', 'C9999999999'],
    });

    expect(result.resolved).toEqual(['C0123456789']);
    expect(result.matches('C0123456789')).toBe(true);
    expect(result.matches('C9999999999')).toBe(false);
  });

  it('(d) empty includes throws HOLO_ALLOWLIST_EMPTY', async () => {
    // No rows seeded — no includes exist
    await expect(
      resolveAllowlist({ db, organizationId: orgId, provider: PROVIDER }),
    ).rejects.toMatchObject({ code: 'HOLO_ALLOWLIST_EMPTY' });
  });

  it('(e) >50 resolved throws HOLO_ALLOWLIST_OVERSIZED', async () => {
    // Seed 51 exact_id include patterns
    const rows = Array.from({ length: 51 }, (_, i) => ({
      pattern: `REPO${String(i).padStart(4, '0')}`,
      patternKind: 'exact_id' as const,
      decision: 'include' as const,
    }));
    await seedAllowlistRows(db, orgId, userId, PROVIDER, rows);

    // No candidates → project include patterns themselves (51 items)
    await expect(
      resolveAllowlist({ db, organizationId: orgId, provider: PROVIDER }),
    ).rejects.toMatchObject({ code: 'HOLO_ALLOWLIST_OVERSIZED' });
  });

  it('(f) decision=exclude overrides decision=include for same exact_id pattern', async () => {
    await seedAllowlistRows(db, orgId, userId, PROVIDER, [
      { pattern: 'acme/api', patternKind: 'exact_id', decision: 'include' },
      { pattern: 'acme/api', patternKind: 'exact_id', decision: 'exclude' },
    ]);

    const result = await resolveAllowlist({
      db,
      organizationId: orgId,
      provider: PROVIDER,
      candidates: ['acme/api', 'acme/other'],
    });

    expect(result.matches('acme/api')).toBe(false);
    expect(result.resolved).toEqual([]);
  });
});
