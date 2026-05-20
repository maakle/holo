import { describe, it, expect, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  runGithubCodeSync,
  realGitShell,
  type RunGithubCodeSyncInput,
  type GitShell,
  type GithubCodeEmbedEnqueueFn,
} from '../../src/github/sync-code';

const execFileAsync = promisify(execFile);

function mockShell(overrides: Partial<GitShell> = {}): GitShell {
  return {
    clone: vi.fn().mockResolvedValue(undefined),
    lsFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(Buffer.from('const x = 1;\n')),
    headSha: vi.fn().mockResolvedValue('new-sha-abc'),
    fetch: vi.fn().mockResolvedValue(undefined),
    diffNameStatus: vi.fn().mockResolvedValue([]),
    hasClone: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// Returns null so githubCodeChunker falls back to recursiveSplit
const mockTreeSitter = { parse: vi.fn().mockResolvedValue(null) };

function baseInput(overrides: Partial<RunGithubCodeSyncInput> = {}): RunGithubCodeSyncInput {
  return {
    repoFullName: 'org/repo',
    cloneUrl: 'https://x-access-token:tok@github.com/org/repo.git',
    workDir: '/tmp/test-clone',
    organizationId: 'org-1',
    sourceId: 'src-1',
    existingHashes: new Set(),
    enqueueEmbed: vi.fn().mockResolvedValue(undefined),
    treeSitter: mockTreeSitter,
    ...overrides,
  };
}

describe('runGithubCodeSync', () => {
  it('initial sync: clones repo and enqueues chunks for indexable files', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      lsFiles: vi.fn().mockResolvedValue(['src/index.ts', 'README.md']),
      readFile: vi.fn().mockResolvedValue(Buffer.from('export const x = 1;\n')),
    });

    const result = await runGithubCodeSync(baseInput({ gitShell: shell, enqueueEmbed }));

    expect(shell.clone).toHaveBeenCalledWith(
      'https://x-access-token:tok@github.com/org/repo.git',
      '/tmp/test-clone',
    );
    expect(result.artifactCount).toBeGreaterThan(0);
    expect(enqueueEmbed).toHaveBeenCalled();
    const chunks = (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls[0][0].chunks;
    expect(chunks[0].kind).toBe('github-code');
    expect(chunks[0].provider).toBe('github');
  });

  it('initial sync: skips binary files', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      lsFiles: vi.fn().mockResolvedValue(['image.png']),
      readFile: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d])), // PNG with null byte
    });

    const result = await runGithubCodeSync(baseInput({ gitShell: shell, enqueueEmbed }));

    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('initial sync: skips files in node_modules', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      lsFiles: vi.fn().mockResolvedValue(['node_modules/lodash/index.js']),
    });

    const result = await runGithubCodeSync(baseInput({ gitShell: shell, enqueueEmbed }));
    expect(result.artifactCount).toBe(0);
  });

  it('incremental: fetches and diffs from fromSha', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      headSha: vi.fn().mockResolvedValue('new-sha'),
      diffNameStatus: vi.fn().mockResolvedValue([
        { status: 'A', path: 'src/new-file.ts' },
        { status: 'M', path: 'src/existing.ts' },
        { status: 'D', path: 'src/deleted.ts' },
      ]),
      readFile: vi.fn().mockResolvedValue(Buffer.from('const x = 1;\n')),
    });

    const result = await runGithubCodeSync(
      baseInput({ gitShell: shell, enqueueEmbed, fromSha: 'old-sha' }),
    );

    expect(shell.fetch).toHaveBeenCalled();
    expect(shell.clone).not.toHaveBeenCalled();
    expect(shell.diffNameStatus).toHaveBeenCalledWith('/tmp/test-clone', 'old-sha', 'new-sha');
    // Only A and M files are indexed (not D)
    expect(result.artifactCount).toBeGreaterThan(0);
  });

  it('incremental: falls back to clone when workDir was wiped between runs', async () => {
    // The DB cursor (fromSha) outlives the worker's /tmp clone — when /tmp is
    // cleaned (container restart, systemd-tmpfiles), a cursor-driven fetch
    // would `git -C <missing-dir>` and fail. Self-heal by re-cloning instead
    // of getting stuck on every cron until someone clears the cursor.
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      hasClone: vi.fn().mockResolvedValue(false),
      headSha: vi.fn().mockResolvedValue('new-sha'),
      lsFiles: vi.fn().mockResolvedValue(['src/index.ts']),
      readFile: vi.fn().mockResolvedValue(Buffer.from('export const x = 1;\n')),
    });

    const result = await runGithubCodeSync(
      baseInput({ gitShell: shell, enqueueEmbed, fromSha: 'old-sha' }),
    );

    expect(shell.clone).toHaveBeenCalled();
    expect(shell.fetch).not.toHaveBeenCalled();
    // With no usable history we can't diff — fall through to a full walk.
    expect(shell.diffNameStatus).not.toHaveBeenCalled();
    expect(shell.lsFiles).toHaveBeenCalled();
    expect(result.artifactCount).toBeGreaterThan(0);
  });

  it('incremental: no-ops when SHA unchanged', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      headSha: vi.fn().mockResolvedValue('same-sha'),
    });

    const result = await runGithubCodeSync(
      baseInput({ gitShell: shell, enqueueEmbed, fromSha: 'same-sha' }),
    );

    expect(result.artifactCount).toBe(0);
    expect(enqueueEmbed).not.toHaveBeenCalled();
  });

  it('deduplicates against existingHashes', async () => {
    const enqueueEmbed = vi.fn().mockResolvedValue(undefined) as GithubCodeEmbedEnqueueFn;
    const shell = mockShell({
      lsFiles: vi.fn().mockResolvedValue(['src/index.ts']),
      readFile: vi.fn().mockResolvedValue(Buffer.from('export const x = 1;\n')),
    });

    const r1 = await runGithubCodeSync(baseInput({ gitShell: shell, enqueueEmbed }));
    expect(r1.artifactCount).toBeGreaterThan(0);

    const hashes = new Set(
      (enqueueEmbed as ReturnType<typeof vi.fn>).mock.calls
        .flatMap((c: [{ chunks: Array<{ contentHash: string }> }]) =>
          c[0].chunks.map((ch) => ch.contentHash),
        ),
    );

    const r2 = await runGithubCodeSync(
      baseInput({ gitShell: shell, enqueueEmbed: vi.fn(), existingHashes: hashes }),
    );
    expect(r2.artifactCount).toBe(0);
  });

  describe('realGitShell.hasClone', () => {
    it('returns false when .git directory is missing HEAD/config (partial tmpfiles cleanup)', async () => {
      // Reproduces the production failure where /tmp cleaners deleted regular
      // files inside .git but left subdirectories intact. `stat('.git')` would
      // succeed but `git -C dir fetch` then dies with "not a git repository"
      // on every subsequent sync until someone wipes the dir by hand.
      const dir = mkdtempSync(join(tmpdir(), 'holo-clone-test-'));
      try {
        await execFileAsync('git', ['-C', dir, 'init', '--quiet']);
        unlinkSync(join(dir, '.git', 'HEAD'));
        unlinkSync(join(dir, '.git', 'config'));

        expect(await realGitShell.hasClone(dir)).toBe(false);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns true for a healthy git repo', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'holo-clone-test-'));
      try {
        await execFileAsync('git', ['-C', dir, 'init', '--quiet']);
        expect(await realGitShell.hasClone(dir)).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('returns false when the directory does not exist', async () => {
      expect(await realGitShell.hasClone('/tmp/holo-clone-test-does-not-exist-xyz')).toBe(false);
    });
  });

  it('returns headSha in output', async () => {
    const shell = mockShell({
      headSha: vi.fn().mockResolvedValue('deadbeef'),
      lsFiles: vi.fn().mockResolvedValue([]),
    });
    const result = await runGithubCodeSync(baseInput({ gitShell: shell }));
    expect(result.headSha).toBe('deadbeef');
  });
});
