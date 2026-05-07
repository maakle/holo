/**
 * GitHub repo → chunk projection.
 *
 * Bridges the framework's per-resource ctx.upsert path into the legacy
 * runGithubProseSync / runGithubCodeSync engines, which were written
 * before the framework existed and use a callback-based enqueueEmbed shape.
 *
 * The legacy engines own all the heavy lifting (paged API calls, AST/
 * recursive chunking via @holo/chunker, git clone walks, diff-based
 * incremental sync). Wrapping them here keeps GitHub's complex sync logic
 * intact while everything else (tokens, allowlist resolution, cursor
 * persistence, batch flushing) flows through the framework runtime.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { ResourceSyncContext } from '@holo/connector-framework';
import { createGithubApiClient } from './api';
import { runGithubProseSync, type GithubProseChunkPayload } from './sync-prose';
import { runGithubCodeSync, type GithubCodeChunkPayload } from './sync-code';

const SYNC_LOGGER = {
  info: (obj: unknown) => process.stdout.write(`[github-sync] ${JSON.stringify(obj)}\n`),
  warn: (obj: unknown) => process.stderr.write(`[github-sync] ${JSON.stringify(obj)}\n`),
};

interface RunProseInput {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
  allowedRepos: ReadonlyArray<string>;
}

/**
 * Adapter: translates legacy `enqueueEmbed(batch)` calls into per-chunk
 * `ctx.upsert(...)`. The legacy engine pre-computes contentHash; the
 * framework recomputes via `${kind}:${content}` (same algorithm) and
 * deduplicates against the org's existing-hash set internally, so
 * passing an empty Set into the engine just means it doesn't pre-filter
 * — duplicates fall out at upsert time.
 */
function proseEmbedAdapter(ctx: ResourceSyncContext<Record<string, unknown>>) {
  return async (payload: { chunks: GithubProseChunkPayload[] }): Promise<void> => {
    for (const c of payload.chunks) {
      await ctx.upsert({
        externalId: c.sourceArtifactId,
        kind: c.kind,
        content: c.content,
        metadata: c.metadata,
        aclSubjects: c.aclSubjects,
        sourceArtifactId: c.sourceArtifactId,
      });
    }
  };
}

function codeEmbedAdapter(ctx: ResourceSyncContext<Record<string, unknown>>) {
  return async (payload: { chunks: GithubCodeChunkPayload[] }): Promise<void> => {
    for (const c of payload.chunks) {
      await ctx.upsert({
        externalId: c.sourceArtifactId,
        kind: c.kind,
        content: c.content,
        metadata: c.metadata,
        aclSubjects: c.aclSubjects,
        sourceArtifactId: c.sourceArtifactId,
      });
    }
  };
}

export async function processProseRepos(input: RunProseInput): Promise<{
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}> {
  const { ctx, token, allowedRepos } = input;
  return runGithubProseSync({
    client: createGithubApiClient(token),
    allowedRepos: [...allowedRepos],
    cursorMetadata: ctx.cursor,
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    // Framework's runtime owns dedup — pass an empty set and let
    // ctx.upsert filter at the boundary.
    existingHashes: new Set<string>(),
    enqueueEmbed: proseEmbedAdapter(ctx),
    logger: SYNC_LOGGER,
  });
}

interface RunCodeInput {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
  allowedRepos: ReadonlyArray<string>;
  workDirRoot: string;
}

function workDirFor(root: string, repoFullName: string): string {
  const slug = createHash('sha1').update(repoFullName).digest('hex').slice(0, 12);
  return join(root, slug);
}

export async function processCodeRepos(input: RunCodeInput): Promise<{
  artifactCount: number;
  perRepoSha: Record<string, string>;
}> {
  const { ctx, token, allowedRepos, workDirRoot } = input;
  mkdirSync(workDirRoot, { recursive: true });

  const fromSha =
    typeof ctx.cursor['last_indexed_sha'] === 'string'
      ? (ctx.cursor['last_indexed_sha'] as string)
      : undefined;

  let totalArtifacts = 0;
  const perRepoSha: Record<string, string> = {};

  for (const repoFullName of allowedRepos) {
    ctx.signal?.throwIfAborted();
    const workDir = workDirFor(workDirRoot, repoFullName);
    // x-access-token is the documented username for both OAuth and App
    // installation tokens; GitHub treats the username as informational.
    const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;

    const result = await runGithubCodeSync({
      repoFullName,
      cloneUrl,
      workDir,
      fromSha,
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      existingHashes: new Set<string>(),
      enqueueEmbed: codeEmbedAdapter(ctx),
      logger: SYNC_LOGGER,
      // treeSitter intentionally omitted — when null, githubCodeChunker
      // falls back to recursiveSplit. AST chunking can be wired in later
      // via a runtime option without touching the spec.
    });
    totalArtifacts += result.artifactCount;
    perRepoSha[repoFullName] = result.headSha;
  }

  return { artifactCount: totalArtifacts, perRepoSha };
}

export function defaultWorkDirRoot(): string {
  return join(tmpdir(), 'holo-clones');
}
