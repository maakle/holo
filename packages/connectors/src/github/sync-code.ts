import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { githubCodeChunker } from '@holo/chunker';
import type { TreeSitterRegistry } from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import { ErrorCode, holoError } from '@holo/errors';
import { shouldIndex, extToLanguage } from './code-skip';

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
  fetch(dir: string): Promise<void>;
  diffNameStatus(dir: string, fromSha: string, toSha: string): Promise<DiffEntry[]>;
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
        fix: 'Verify the access token has repo scope, the OAuth app is approved for the repo owner (SSO), and the repo exists.',
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

  async fetch(dir) {
    try {
      await execFileAsync('git', ['-C', dir, 'fetch', '--depth=1', 'origin']);
    } catch (cause) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `git fetch failed in ${dir}`,
        fix: 'Check network connectivity and access token.',
        cause: redactSecrets(String(cause)),
      });
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
  logger?: { warn(obj: unknown): void };
}

export interface RunGithubCodeSyncOutput {
  artifactCount: number;
  headSha: string;
}

export async function runGithubCodeSync(
  input: RunGithubCodeSyncInput,
): Promise<RunGithubCodeSyncOutput> {
  const shell = input.gitShell ?? realGitShell;
  const logger = input.logger ?? { warn: () => {} };
  const ctx = {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
    treeSitter: input.treeSitter,
  };

  // Clone or fetch
  if (input.fromSha) {
    await shell.fetch(input.workDir);
  } else {
    await shell.clone(input.cloneUrl, input.workDir);
  }

  const headSha = await shell.headSha(input.workDir);
  if (input.fromSha && headSha === input.fromSha) {
    return { artifactCount: 0, headSha };
  }

  // Determine which files to process
  let filePaths: string[];
  if (input.fromSha) {
    const diff = await shell.diffNameStatus(input.workDir, input.fromSha, headSha);
    filePaths = diff
      .filter((e) => e.status === 'A' || e.status === 'M')
      .map((e) => e.path);
  } else {
    filePaths = await shell.lsFiles(input.workDir);
  }

  const pending: GithubCodeChunkPayload[] = [];
  let totalArtifacts = 0;

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

    if (!shouldIndex(filePath, buf.length, buf)) continue;

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
      logger.warn({ code: 'HOLO_CHUNK_FAILED', filePath, error: String(err) });
      continue;
    }

    for (const c of chunks) {
      const hash = chunkHash('github-code', c.content);
      if (input.existingHashes.has(hash)) continue;
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
  return { artifactCount: totalArtifacts, headSha };
}
