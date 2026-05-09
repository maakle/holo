/**
 * GitLab project → chunk projection.
 *
 * Adapter from the prose / code engines' batch-shaped `enqueueEmbed`
 * callback to the framework's per-chunk `ctx.upsert`. Mirrors the
 * GitHub `chunking.ts` adapter so the spec's resource sync functions
 * stay one-line wrappers.
 */
import type { ResourceSyncContext } from '@holo/connector-framework';
import { createGitlabApiClient } from './api';
import {
  runGitlabProseSync,
  type GitlabProseChunkPayload,
} from './sync-prose';
import {
  runGitlabCodeSync,
  type GitlabCodeChunkPayload,
} from './sync-code';

const SYNC_LOGGER = {
  info: (obj: unknown) => process.stdout.write(`[gitlab-sync] ${JSON.stringify(obj)}\n`),
  warn: (obj: unknown) => process.stderr.write(`[gitlab-sync] ${JSON.stringify(obj)}\n`),
};

interface RunProseInput {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
  allowedProjects: ReadonlyArray<{ id: number; pathWithNamespace: string; defaultBranch: string | null }>;
}

function proseEmbedAdapter(ctx: ResourceSyncContext<Record<string, unknown>>) {
  return async (payload: { chunks: GitlabProseChunkPayload[] }): Promise<void> => {
    for (const c of payload.chunks) {
      await ctx.upsert({
        externalId: c.externalId,
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
  return async (payload: { chunks: GitlabCodeChunkPayload[] }): Promise<void> => {
    for (const c of payload.chunks) {
      await ctx.upsert({
        externalId: c.externalId,
        kind: c.kind,
        content: c.content,
        metadata: c.metadata,
        aclSubjects: c.aclSubjects,
        sourceArtifactId: c.sourceArtifactId,
      });
    }
  };
}

export async function processProseProjects(input: RunProseInput): Promise<{
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}> {
  const { ctx, token, allowedProjects } = input;
  return runGitlabProseSync({
    client: createGitlabApiClient(token),
    allowedProjects,
    cursorMetadata: ctx.cursor,
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    enqueueEmbed: proseEmbedAdapter(ctx),
    logger: SYNC_LOGGER,
  });
}

interface RunCodeInput {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
  allowedProjects: ReadonlyArray<{ id: number; pathWithNamespace: string; defaultBranch: string | null }>;
}

export async function processCodeProjects(input: RunCodeInput): Promise<{
  artifactCount: number;
  perProjectSha: Record<string, string>;
}> {
  const { ctx, token, allowedProjects } = input;
  const client = createGitlabApiClient(token);

  // Cursor: per-project SHA map keyed by project id. Mirrors GitHub's
  // `per_repo_sha` shape so dashboards displaying both providers don't
  // have to special-case the field name.
  const priorPerProjectSha =
    typeof ctx.cursor['per_project_sha'] === 'object' && ctx.cursor['per_project_sha'] !== null
      ? (ctx.cursor['per_project_sha'] as Record<string, string>)
      : {};

  let totalArtifacts = 0;
  const perProjectSha: Record<string, string> = { ...priorPerProjectSha };

  for (const project of allowedProjects) {
    ctx.signal?.throwIfAborted();
    const result = await runGitlabCodeSync({
      client,
      project,
      fromSha: priorPerProjectSha[String(project.id)],
      organizationId: ctx.organizationId,
      sourceId: ctx.sourceId,
      enqueueEmbed: codeEmbedAdapter(ctx),
      logger: SYNC_LOGGER,
    });
    totalArtifacts += result.artifactCount;
    if (result.headSha) perProjectSha[String(project.id)] = result.headSha;
  }

  return { artifactCount: totalArtifacts, perProjectSha };
}
