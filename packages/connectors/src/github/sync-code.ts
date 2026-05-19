import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile as fsReadFile, stat } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { githubCodeChunker } from '@holo/chunker';
import type { TreeSitterRegistry } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import { ErrorCode, holoError } from '@holo/errors';
import { shouldIndex, extToLanguage } from '../code-skip';

const execFileAsync = promisify(execFile);
const BATCH_SIZE = 50;

export type GithubCodeChunkPayload = {
  kind: 'github-code';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'github';
  sourceId: string;
  organizationId: string;
};

export type GithubCodeEmbedEnqueueFn = (payload: {
  chunks: GithubCodeChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface DiffEntry {
  status: 'A' | 'M' | 'D';
  path: string;
}

export interface GitShell {
  clone(repoUrl: string, dir: string): Promise<void>;
  lsFiles(dir: string): Promise<string[]>;
  readFile(dir: string, filePath: string): Promise<Buffer>;
  headSha(dir: string): Promise<string>;
  fetch(dir: string, repoUrl: string): Promise<void>;
  diffNameStatus(dir: string, fromSha: string, toSha: string): Promise<DiffEntry[]>;
  /** True if `dir` contains a usable git checkout — `.git` exists. */
  hasClone(dir: string): Promise<boolean>;
}

function redactUrl(url: string): string {
  // Strip basic-auth / token from URLs so we don't leak access tokens into
  // logs, error messages, or the sync-history UI. Matches `https://<user>:<pw>@host…`
  // and `https://<token>@host…`.
  return url.replace(/(https?:\/\/)([^@/]+)@/, '$1<redacted>@');
}

function redactSecrets(s: string): string {
  // GitHub user-to-server tokens (gho_), app tokens (ghs_), refresh tokens
  // (ghr_), personal access tokens (ghp_), server tokens (ghu_). Strip them
  // wherever they appear so stack traces / git stderr can't leak credentials.
  return redactUrl(s).replace(/gh[opusr]_[A-Za-z0-9]{20,}/g, '<redacted-token>');
}

// Disable any local-machine git config that could intercept the URL-embedded
// token: credential helpers (osxkeychain), [url] insteadOf rewrites that
// switch to SSH, askpass prompts. Run with no system config and an empty
// HOME so a developer's ~/.gitconfig can't poison the worker.
const ISOLATED_GIT_CONFIG = [
  '-c', 'credential.helper=',
  '-c', 'core.askpass=',
  '-c', 'core.sshCommand=true',
  '-c', 'http.followRedirects=true',
];
function isolatedGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_ASKPASS: '/bin/true',
    HOME: '/dev/null',
  };
}

export const realGitShell: GitShell = {
  async clone(repoUrl, dir) {
    // Clear the workDir if a previous attempt left content behind.
    // `git clone` refuses to clone into a non-empty directory, so a single
    // failed sync would otherwise wedge every subsequent sync until someone
    // SSH'd into the worker and rm'd by hand. The workDir lives under
    // os.tmpdir()/holo-clones/<sha-of-repo-name>, which we own end-to-end.
    rmSync(dir, { recursive: true, force: true });

    try {
      await execFileAsync(
        'git',
        [...ISOLATED_GIT_CONFIG, 'clone', '--depth=1', repoUrl, dir],
        { env: isolatedGitEnv() },
      );
    } catch (cause) {
      throw holoError({
        code: ErrorCode.HOLO_CLONE_FAILED,
        problem: `git clone failed for ${redactUrl(repoUrl)}`,
        fix: 'Verify the App installation has access to the repo and that the access token has Contents: Read.',
        cause: redactSecrets(String(cause)),
      });
    }
  },

  async lsFiles(dir) {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'ls-files', '-z']);
    return stdout.split('\0').filter(Boolean);
  },

  async readFile(dir, filePath) {
    return fsReadFile(join(dir, filePath));
  },

  async headSha(dir) {
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD']);
    return stdout.trim();
  },

  async fetch(dir, repoUrl) {
    // Fetch from the URL directly rather than the baked-in `remote.origin.url`.
    // GitHub App installation tokens (and OAuth tokens) embedded at clone time
    // expire after ~1 hour; relying on the stale URL from the initial clone
    // makes every subsequent incremental sync fail with "Invalid username or
    // token". The caller mints a fresh token per run and passes it here.
    try {
      await execFileAsync(
        'git',
        [...ISOLATED_GIT_CONFIG, '-C', dir, 'fetch', '--depth=1', repoUrl],
        { env: isolatedGitEnv() },
      );
    } catch (cause) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `git fetch failed in ${dir}`,
        fix: 'Verify the App installation has access to the repo and that the access token has Contents: Read.',
        cause: redactSecrets(String(cause)),
      });
    }
  },

  async hasClone(dir) {
    // workDir lives under os.tmpdir(), which is wiped on container restart,
    // serverless cold boot, systemd-tmpfiles cleanup, and pod reschedules.
    // The cursor (last_indexed_sha) lives in the DB and outlives /tmp, so
    // probe the filesystem before assuming an incremental fetch will work —
    // otherwise `git -C <missing-dir>` errors permanently until the cursor
    // is manually cleared.
    try {
      const s = await stat(join(dir, '.git'));
      return s.isDirectory() || s.isFile();
    } catch {
      return false;
    }
  },

  async diffNameStatus(dir, fromSha, toSha) {
    const { stdout } = await execFileAsync('git', [
      '-C', dir,
      'diff', '--name-status', '--diff-filter=AMD', `${fromSha}..${toSha}`,
    ]);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split('\t');
        return { status: (status?.trim() ?? 'A') as 'A' | 'M' | 'D', path: rest[0] ?? '' };
      })
      .filter((e) => e.path);
  },
};

export interface RunGithubCodeSyncInput {
  repoFullName: string;
  cloneUrl: string;
  workDir: string;
  /** If set, run incremental diff from this SHA to HEAD. Otherwise, walk all files. */
  fromSha?: string;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: GithubCodeEmbedEnqueueFn;
  gitShell?: GitShell;
  treeSitter?: TreeSitterRegistry;
  logger?: SyncLogger;
}

export interface SyncLogger {
  info(obj: unknown): void;
  warn(obj: unknown): void;
}

export interface RunGithubCodeSyncOutput {
  artifactCount: number;
  headSha: string;
}

export async function runGithubCodeSync(
  input: RunGithubCodeSyncInput,
): Promise<RunGithubCodeSyncOutput> {
  const shell = input.gitShell ?? realGitShell;
  const logger: SyncLogger = input.logger ?? { info: () => {}, warn: () => {} };
  const ctx = {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    treeSitter: input.treeSitter,
  };

  // Clone or fetch — both need a fresh token-bearing URL because install
  // tokens expire after ~1 hour, so an incremental sync 6h after the initial
  // clone can't reuse the URL git stored in `remote.origin.url`. The cursor
  // (`fromSha`) lives in the DB and outlives the worker's /tmp, so verify
  // the clone is still on disk before taking the incremental path.
  const canIncrement = Boolean(input.fromSha) && (await shell.hasClone(input.workDir));
  if (canIncrement) {
    await shell.fetch(input.workDir, input.cloneUrl);
  } else {
    await shell.clone(input.cloneUrl, input.workDir);
  }

  const headSha = await shell.headSha(input.workDir);
  if (canIncrement && headSha === input.fromSha) {
    return { artifactCount: 0, headSha };
  }

  // Determine which files to process. After a forced re-clone (cursor present
  // but workDir gone) we don't have the `fromSha` commit locally, so fall
  // through to a full walk and let downstream content-hash dedupe absorb the
  // redundancy.
  let filePaths: string[];
  if (canIncrement && input.fromSha) {
    const diff = await shell.diffNameStatus(input.workDir, input.fromSha, headSha);
    filePaths = diff
      .filter((e) => e.status === 'A' || e.status === 'M')
      .map((e) => e.path);
  } else {
    filePaths = await shell.lsFiles(input.workDir);
  }

  logger.info({
    event: 'github_code_walk_start',
    repo: input.repoFullName,
    fromSha: input.fromSha ?? null,
    headSha,
    fileCount: filePaths.length,
  });

  const pending: GithubCodeChunkPayload[] = [];
  let totalArtifacts = 0;
  let indexed = 0;
  let skipped = 0;
  let chunkFailed = 0;
  let dedupedHashes = 0;

  const flushBatch = async () => {
    if (pending.length === 0) return;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      await input.enqueueEmbed({
        chunks: pending.slice(i, i + BATCH_SIZE),
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
    }
    totalArtifacts += pending.length;
    pending.length = 0;
  };

  for (const filePath of filePaths) {
    let buf: Buffer;
    try {
      buf = await shell.readFile(input.workDir, filePath);
    } catch {
      logger.warn({ code: 'HOLO_GITHUB_READ_FAILED', filePath });
      continue;
    }

    if (!shouldIndex(filePath, buf.length, buf)) {
      skipped += 1;
      continue;
    }
    indexed += 1;

    const language = extToLanguage(filePath);
    const content = buf.toString('utf8');
    const sourceArtifactId = `github-code:${input.repoFullName}:${headSha}:${filePath}`;

    let chunks;
    try {
      chunks = await githubCodeChunker.chunk(
        { repoFullName: input.repoFullName, commitSha: headSha, filePath, language, content },
        { sourceArtifactId, ...ctx },
      );
    } catch (err) {
      chunkFailed += 1;
      logger.warn({ code: 'HOLO_CHUNK_FAILED', filePath, error: String(err) });
      continue;
    }

    for (const c of chunks) {
      const hash = chunkHash('github-code', c.content);
      if (input.existingHashes.has(hash)) {
        dedupedHashes += 1;
        continue;
      }
      pending.push({
        kind: 'github-code',
        content: c.content,
        metadata: c.metadata,
        aclSubjects: c.aclSubjects,
        contentHash: hash,
        sourceArtifactId,
        provider: 'github',
        sourceId: input.sourceId,
        organizationId: input.organizationId,
      });
    }

    if (pending.length >= BATCH_SIZE) await flushBatch();
  }

  await flushBatch();
  logger.info({
    event: 'github_code_walk_done',
    repo: input.repoFullName,
    fileCount: filePaths.length,
    indexed,
    skipped,
    chunkFailed,
    dedupedHashes,
    artifactCount: totalArtifacts,
  });
  return { artifactCount: totalArtifacts, headSha };
}
