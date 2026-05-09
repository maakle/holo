/**
 * GitLab "code" sync: walks the repository tree on the default branch
 * via the REST API, fetches each text blob, and emits chunks.
 *
 * v1 deliberately uses the API (not `git clone`) for portability — it
 * avoids the worker needing git installed and a writable temp dir, and
 * keeps the sync stateless. Big monorepos pay a per-file round-trip
 * cost, but the framework's rate limiter + Retry-After absorb GitLab's
 * 429s, and the head-SHA cursor lets incremental runs short-circuit
 * unchanged repos entirely.
 *
 * Skip rules mirror what most code-search tools omit: binaries by
 * extension, vendored / generated paths, files larger than 256 KB, and
 * lockfiles. We accept the false-negative risk on edge cases (a 300 KB
 * SQL dump doesn't get indexed) over the cost of embedding noise.
 */
import { recursiveSplit } from '@holo/chunker';
import type { GitlabApiClient, GitlabRepoTreeEntry } from './api';

export interface GitlabCodeChunkPayload {
  externalId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  sourceArtifactId: string;
  contentHash?: string;
}

export type GitlabCodeEmbedEnqueueFn = (payload: {
  chunks: GitlabCodeChunkPayload[];
}) => Promise<void>;

export interface RunGitlabCodeSyncInput {
  client: GitlabApiClient;
  project: { id: number; pathWithNamespace: string; defaultBranch: string | null };
  /** SHA of the previously indexed head, if any. */
  fromSha?: string;
  organizationId: string;
  sourceId: string;
  enqueueEmbed: GitlabCodeEmbedEnqueueFn;
  logger?: { info(obj: unknown): void; warn(obj: unknown): void };
}

export interface RunGitlabCodeSyncOutput {
  artifactCount: number;
  /** New head SHA if we indexed anything, or the prior `fromSha` if skipped. */
  headSha: string;
}

const MAX_FILE_BYTES = 256 * 1024;

const SKIP_PATH_PREFIXES = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.next/',
  '.git/',
  '.cache/',
  '__pycache__/',
];

const SKIP_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg',
  'pdf', 'zip', 'tar', 'gz', 'tgz', 'rar', '7z',
  'mp3', 'mp4', 'mov', 'avi', 'webm', 'wav',
  'woff', 'woff2', 'ttf', 'eot',
  'jar', 'class', 'so', 'dll', 'exe', 'bin',
  'pdb', 'lockb',
]);

const SKIP_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
]);

function shouldSkip(entry: GitlabRepoTreeEntry): boolean {
  if (entry.type !== 'blob') return true;
  for (const prefix of SKIP_PATH_PREFIXES) {
    if (entry.path.startsWith(prefix) || entry.path.includes(`/${prefix}`)) return true;
  }
  if (SKIP_FILENAMES.has(entry.name)) return true;
  const dotIdx = entry.name.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = entry.name.slice(dotIdx + 1).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) return true;
  }
  return false;
}

export async function runGitlabCodeSync(
  input: RunGitlabCodeSyncInput,
): Promise<RunGitlabCodeSyncOutput> {
  const { client, project, fromSha, organizationId, enqueueEmbed, logger } = input;
  const acl = [`org:${organizationId}`];

  if (!project.defaultBranch) {
    logger?.warn({ msg: 'gitlab-code skip: no default branch', project: project.pathWithNamespace });
    return { artifactCount: 0, headSha: fromSha ?? '' };
  }

  const branch = await client.getBranch(project.id, project.defaultBranch);
  if (!branch) {
    logger?.warn({ msg: 'gitlab-code skip: branch missing', project: project.pathWithNamespace, ref: project.defaultBranch });
    return { artifactCount: 0, headSha: fromSha ?? '' };
  }

  if (fromSha && fromSha === branch.commit.id) {
    logger?.info({ msg: 'gitlab-code skip: head unchanged', project: project.pathWithNamespace, sha: branch.commit.id });
    return { artifactCount: 0, headSha: branch.commit.id };
  }

  const tree = await client.listRepositoryTree(project.id, branch.commit.id);
  let artifactCount = 0;

  for (const entry of tree) {
    if (shouldSkip(entry)) continue;

    const raw = await client.getFileRaw(project.id, entry.path, branch.commit.id);
    if (raw === null) continue;
    if (raw.length === 0) continue;
    if (raw.length > MAX_FILE_BYTES) continue;
    // Heuristic binary check — null byte in the first 8 KB.
    if (raw.slice(0, 8192).includes('\u0000')) continue;

    const breadcrumb = `${project.pathWithNamespace} / ${entry.path}`;
    const sourceArtifactId = `gitlab-code:${project.pathWithNamespace}:${entry.path}`;
    const pieces = recursiveSplit(raw, { chunkSize: 1500, overlap: 200 });
    const chunks: GitlabCodeChunkPayload[] = pieces.map((text, idx) => ({
      externalId: `${sourceArtifactId}#${idx}`,
      kind: 'gitlab-code',
      content: `${breadcrumb}\n\n${text}`,
      metadata: {
        project_id: project.id,
        project_path: project.pathWithNamespace,
        file_path: entry.path,
        sha: branch.commit.id,
        breadcrumb,
      },
      aclSubjects: acl,
      sourceArtifactId,
    }));

    if (chunks.length > 0) {
      await enqueueEmbed({ chunks });
      artifactCount += 1;
    }
  }

  logger?.info({ msg: 'gitlab-code project done', project: project.pathWithNamespace, sha: branch.commit.id, artifacts: artifactCount });
  return { artifactCount, headSha: branch.commit.id };
}
