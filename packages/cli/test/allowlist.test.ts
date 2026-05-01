import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { runAllowlistAdd } from '../src/commands/allowlist-add.js';
import { runAllowlistRemove } from '../src/commands/allowlist-remove.js';
import { renderListGithub } from '../src/commands/allowlist-list-github.js';
import { createDb, type DB } from '@holo/db';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let db: DB;
let orgId: string;
let userId: string;

beforeAll(async () => {
  db = createDb(url);
  // Find or create test org + user
  const orgRes = await db.execute<{ id: string }>(sql`
    INSERT INTO organization (slug, name)
    VALUES ('test-cli-allowlist', 'CLI test org')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  orgId = ((orgRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (orgRes as unknown as Array<{ id: string }>))[0]!.id;

  const userRes = await db.execute<{ id: string }>(sql`
    INSERT INTO "user" (id, email, name, email_verified, organization_id, created_at, updated_at)
    VALUES (gen_random_uuid(), 'cli-test@holo.test', 'CLI Test', false, ${orgId}, now(), now())
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  userId = ((userRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (userRes as unknown as Array<{ id: string }>))[0]!.id;
});

afterEach(async () => {
  await db.execute(sql`
    DELETE FROM connector_allowlists WHERE organization_id = ${orgId}
  `);
});

afterAll(async () => {
  await db.execute(sql`
    DELETE FROM connector_allowlists WHERE organization_id = ${orgId}
  `);
});

describe('allowlist add', () => {
  it('inserts a glob pattern with pattern_kind=glob', async () => {
    const id = await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'github',
      pattern: 'kombo-tech/*',
      exclude: false,
      note: 'all kombo repos',
      createdBy: userId,
    });
    expect(id).toBeTruthy();
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('kombo-tech/*');
    expect(out).toContain('glob');
    expect(out).toContain('all kombo repos');
  });

  it('inserts an exact_id pattern (no glob chars)', async () => {
    const id = await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'github',
      pattern: 'kombo-tech/api',
      exclude: false,
      createdBy: userId,
    });
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('exact_id');
    expect(id).toBeTruthy();
  });

  it('--exclude inserts decision=exclude', async () => {
    await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'github',
      pattern: 'kombo-tech/secret-*',
      exclude: true,
      createdBy: userId,
    });
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('exclude');
  });

  it('rejects unknown provider with HOLO_INVALID_INPUT', async () => {
    await expect(
      runAllowlistAdd({
        db,
        organizationId: orgId,
        provider: 'twitter' as 'github',
        pattern: 'x',
        exclude: false,
        createdBy: userId,
      }),
    ).rejects.toMatchObject({ code: 'HOLO_INVALID_INPUT' });
  });
});

describe('allowlist remove', () => {
  it('removes by id', async () => {
    const id = await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'github',
      pattern: 'kombo-tech/api',
      exclude: false,
      createdBy: userId,
    });
    await runAllowlistRemove({ db, organizationId: orgId, id });
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('no github allowlist patterns');
  });

  it('throws HOLO_NOT_FOUND when id does not exist', async () => {
    await expect(
      runAllowlistRemove({
        db,
        organizationId: orgId,
        id: '00000000-0000-0000-0000-0000DEADBEE0',
      }),
    ).rejects.toMatchObject({ code: 'HOLO_NOT_FOUND' });
  });
});

describe('allowlist list github', () => {
  it('renders empty-state when no github rows', async () => {
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('no github allowlist patterns');
  });

  it('renders github rows only with all columns', async () => {
    await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'github',
      pattern: 'kombo-tech/*',
      exclude: false,
      createdBy: userId,
    });
    await runAllowlistAdd({
      db,
      organizationId: orgId,
      provider: 'slack',
      pattern: 'C0123ABCD',
      exclude: false,
      createdBy: userId,
    });
    const out = await renderListGithub({ db, organizationId: orgId });
    expect(out).toContain('kombo-tech/*');
    expect(out).not.toContain('C0123ABCD');
  });
});
