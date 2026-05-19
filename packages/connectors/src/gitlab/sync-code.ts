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
 * Skip rules + chunk params are shared with the GitHub connector via
 * `./code-skip` so both code paths use the same allow/deny policy and the
 * same code-tuned chunk window. The `kind: 'gitlab-code'` tag is routed to
 * voyage-code-3 by both `packages/embedder/src/router.ts` and the worker's
 * `embed-runner.ts:modelForChunkKind` — keep all three lists in sync.
 */
import { recursiveSplit } from '@holo/chunker';
import type { GitlabApiClient, GitlabRepoTreeEntry } from './api';
import { extToLanguage, shouldIndexByPath } from '../code-skip';

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

// Bumped from 256 KB to 1 MB to match the GitHub connector's policy
// (packages/connectors/src/github/code-skip.ts:MAX_FILE_SIZE). Per-file API
// cost is higher than git clone, but uniform behavior across providers is
// worth more than the marginal saving on the long-tail of >256 KB files.
const MAX_FILE_BYTES = 1_000_000;

function shouldSkip(entry: GitlabRepoTreeEntry): boolean {
  if (entry.type !== 'blob') return true;
  return !shouldIndexByPath(entry.path);
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
    const language = extToLanguage(entry.path);
    // Code-tuned chunk window matches the GitHub connector's code chunker
    // (packages/chunker/src/github-code.ts:68) so retrieval clusters GitLab
    // and GitHub code identically.
    const pieces = recursiveSplit(raw, { chunkSize: 4800, overlap: 600 });
    const chunks: GitlabCodeChunkPayload[] = pieces.map((text, idx) => ({
      externalId: `${sourceArtifactId}#${idx}`,
      kind: 'gitlab-code',
      content: `${breadcrumb}\n\n${text}`,
      metadata: {
        project_id: project.id,
        project_path: project.pathWithNamespace,
        file_path: entry.path,
        sha: branch.commit.id,
        language,
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
