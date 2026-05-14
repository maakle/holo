import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDb, type DB } from '@holo/db';
import { HoloFs } from '../src/fs';
import { ENOENT } from '../src/errors';
import { seedFixture, wipeFixture, type Fixture } from './fixture';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
const PREFIX = 'test-holofs';

let db: DB;
let fx: Fixture;

beforeAll(async () => {
  db = createDb(url);
  await wipeFixture(db, PREFIX);
  fx = await seedFixture(db, PREFIX);
});

afterAll(async () => {
  await wipeFixture(db, PREFIX);
});

describe('HoloFs readdir', () => {
  it('admin sees /slack and /notion at root', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const entries = await fs.readdir('/');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['notion', 'slack']);
    expect(entries.every((e) => e.type === 'directory')).toBe(true);
  });

  it('admin sees both channels under /slack', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const entries = await fs.readdir('/slack');
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['#exec-pay', '#general']);
  });

  it('restricted user sees only #general (not #exec-pay)', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.restrictedSubjects,
    });
    const entries = await fs.readdir('/slack');
    const names = entries.map((e) => e.name);
    expect(names).toEqual(['#general']);
  });

  it('restricted user does NOT see /notion at all (no notion-page-tree subject)', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.restrictedSubjects,
    });
    const entries = await fs.readdir('/');
    const names = entries.map((e) => e.name);
    expect(names).toEqual(['slack']);
  });

  it('no-access user sees empty root', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.noAccessSubjects,
    });
    expect(await fs.readdir('/')).toEqual([]);
  });
});

describe('HoloFs stat + readFile — happy paths', () => {
  it('stat on root returns directory', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const stat = await fs.stat('/');
    expect(stat.type).toBe('directory');
    expect(stat.path).toBe('/');
  });

  it('stat on a visible file returns file metadata', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const path = fx.orgA.artifactIds.find((a) => a.path.includes('#general'))!.path;
    const stat = await fs.stat(path);
    expect(stat.type).toBe('file');
    expect(stat.kind).toBe('slack-thread');
    expect(stat.artifactId).toBeDefined();
  });

  it('readFile returns rendered content for an admin', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const path = fx.orgA.artifactIds.find((a) => a.path.includes('#general'))!.path;
    const content = await fs.readFile(path);
    expect(content).toContain('general thread');
    expect(content).toContain(fx.orgA.slug);
  });
});

describe('HoloFs — adversarial ACL', () => {
  it('cross-tenant readFile throws ENOENT (no leak)', async () => {
    // OrgA user trying to read an OrgB path.
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const orgBPath = fx.orgB.artifactIds[0]!.path;
    await expect(fs.readFile(orgBPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cross-tenant stat throws ENOENT', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const orgBPath = fx.orgB.artifactIds[0]!.path;
    await expect(fs.stat(orgBPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restricted user cannot stat a forbidden file even with right org', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.restrictedSubjects,
    });
    const execPath = fx.orgA.artifactIds.find((a) => a.path.includes('#exec-pay'))!.path;
    await expect(fs.stat(execPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restricted user cannot readFile a forbidden file', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.restrictedSubjects,
    });
    const execPath = fx.orgA.artifactIds.find((a) => a.path.includes('#exec-pay'))!.path;
    await expect(fs.readFile(execPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('readdir under a forbidden directory returns empty', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.restrictedSubjects,
    });
    // Restricted user has no notion-page-tree:* subject.
    expect(await fs.readdir('/notion')).toEqual([]);
  });

  it('path traversal rejects before SQL runs', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    await expect(fs.readFile('/slack/../etc/passwd')).rejects.toMatchObject({
      code: 'EINVAL',
    });
  });
});

describe('HoloFs writes — always EROFS', () => {
  it('writeFile, mkdir, unlink, rmdir, rename all throw EROFS', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    await expect(fs.writeFile('/x')).rejects.toMatchObject({ code: 'EROFS' });
    await expect(fs.mkdir('/x')).rejects.toMatchObject({ code: 'EROFS' });
    await expect(fs.unlink('/x')).rejects.toMatchObject({ code: 'EROFS' });
    await expect(fs.rmdir('/x')).rejects.toMatchObject({ code: 'EROFS' });
    await expect(fs.rename('/x')).rejects.toMatchObject({ code: 'EROFS' });
  });
});

describe('HoloFs resolveArtifactId (Phase 4 shim helper)', () => {
  it('returns artifactId for a visible path', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const target = fx.orgA.artifactIds[0]!;
    const id = await fs.resolveArtifactId(target.path);
    expect(id).toBe(target.id);
  });

  it('returns null for a cross-tenant path', async () => {
    const fs = new HoloFs({
      db,
      organizationId: fx.orgA.id,
      userSubjects: fx.orgA.adminSubjects,
    });
    const id = await fs.resolveArtifactId(fx.orgB.artifactIds[0]!.path);
    expect(id).toBeNull();
  });
});

// Sanity: ENOENT export is a named export from the module.
describe('errors export', () => {
  it('ENOENT is exported', () => {
    expect(typeof ENOENT).toBe('function');
  });
});
