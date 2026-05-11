/**
 * GitLab "prose" sync: README/Markdown docs, merge requests (description +
 * notes), and issues (description + notes).
 *
 * Cursor watermark is per-project `updated_at` — GitLab's `updated_after`
 * filter on `/projects/:id/merge_requests` and `/projects/:id/issues` lets
 * us replay only what changed since the last run. README is refetched on
 * every run (cheap, single GET) since GitLab doesn't surface a per-file
 * "modified since" query without a tree walk.
 *
 * Chunks are emitted via `enqueueEmbed`, mirroring the GitHub prose
 * engine's batch shape so the framework adapter in `chunking.ts` can
 * funnel them straight into `ctx.upsert`.
 */
import { recursiveSplit } from '@holo/chunker';
import type { GitlabApiClient } from './api';

export interface GitlabProseChunkPayload {
  externalId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  sourceArtifactId: string;
  contentHash?: string;
}

export type GitlabProseEmbedEnqueueFn = (payload: {
  chunks: GitlabProseChunkPayload[];
}) => Promise<void>;

export interface RunGitlabProseSyncInput {
  client: GitlabApiClient;
  /**
   * Projects to sync, identified by both numeric id and the human
   * `path_with_namespace`. Numeric id is required — most GitLab REST
   * endpoints accept either, but the URL-encoded path form trips up
   * groups containing slashes more often than the id form.
   */
  allowedProjects: ReadonlyArray<{ id: number; pathWithNamespace: string; defaultBranch: string | null }>;
  cursorMetadata: Record<string, unknown>;
  organizationId: string;
  sourceId: string;
  enqueueEmbed: GitlabProseEmbedEnqueueFn;
  logger?: { info(obj: unknown): void; warn(obj: unknown): void };
}

export interface RunGitlabProseSyncOutput {
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}

const README_CANDIDATES = ['README.md', 'README.MD', 'Readme.md', 'readme.md', 'README'];

function aclFor(orgId: string): string[] {
  return [`org:${orgId}`];
}

function readPerProjectUpdatedAt(
  cursor: Record<string, unknown>,
): Record<string, string> {
  const raw = cursor['per_project_updated_at'];
  if (raw && typeof raw === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  return {};
}

export async function runGitlabProseSync(
  input: RunGitlabProseSyncInput,
): Promise<RunGitlabProseSyncOutput> {
  const { client, allowedProjects, organizationId, enqueueEmbed, logger } = input;
  const acl = aclFor(organizationId);
  const perProjectUpdatedAt = readPerProjectUpdatedAt(input.cursorMetadata);

  let artifactCount = 0;

  for (const project of allowedProjects) {
    const projectKey = String(project.id);
    const since = perProjectUpdatedAt[projectKey];
    let highestUpdatedAt = since ?? '';

    // README — refresh every run; recursive split for long files.
    if (project.defaultBranch) {
      const readme = await fetchReadme(client, project.id, project.defaultBranch);
      if (readme) {
        const breadcrumb = `${project.pathWithNamespace} / ${readme.path}`;
        const pieces = recursiveSplit(readme.content, { chunkSize: 1200, overlap: 150 });
        const sourceArtifactId = `gitlab-doc:${project.pathWithNamespace}:${readme.path}`;
        const chunks: GitlabProseChunkPayload[] = pieces.map((text, idx) => ({
          externalId: `${sourceArtifactId}#${idx}`,
          kind: 'gitlab-doc',
          content: `${breadcrumb}\n\n${text}`,
          metadata: {
            project_id: project.id,
            project_path: project.pathWithNamespace,
            file_path: readme.path,
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
    }

    // Merge requests — paged, filtered by updated_after.
    try {
      const mrs = await client.listMergeRequests(project.id, { updatedAfter: since });
      for (const mr of mrs) {
        const notes = await client.listMergeRequestNotes(project.id, mr.iid);
        const sourceArtifactId = `gitlab-mr:${project.pathWithNamespace}!${mr.iid}`;
        const chunks: GitlabProseChunkPayload[] = [];
        chunks.push({
          externalId: `${sourceArtifactId}:body`,
          kind: 'gitlab-mr',
          content: `# ${mr.title}\n\n${mr.description ?? ''}`,
          metadata: {
            project_id: project.id,
            project_path: project.pathWithNamespace,
            mr_iid: mr.iid,
            state: mr.state,
            web_url: mr.web_url,
            kind: 'body',
          },
          aclSubjects: acl,
          sourceArtifactId,
        });
        for (const n of notes) {
          if (n.system) continue; // skip "added label", "merged", etc.
          if (!n.body || n.body.trim().length === 0) continue;
          chunks.push({
            externalId: `${sourceArtifactId}:note:${n.id}`,
            kind: 'gitlab-mr',
            content: `${n.author.username}: ${n.body}`,
            metadata: {
              project_id: project.id,
              project_path: project.pathWithNamespace,
              mr_iid: mr.iid,
              note_id: n.id,
              kind: 'note',
            },
            aclSubjects: acl,
            sourceArtifactId,
          });
        }
        await enqueueEmbed({ chunks });
        artifactCount += 1;
        if (mr.updated_at > highestUpdatedAt) highestUpdatedAt = mr.updated_at;
      }
    } catch (err) {
      logger?.warn({ msg: 'gitlab-mr-sync project failed', project: project.pathWithNamespace, err: String(err) });
    }

    // Issues — same shape as MRs.
    try {
      const issues = await client.listIssues(project.id, { updatedAfter: since });
      for (const issue of issues) {
        const notes = await client.listIssueNotes(project.id, issue.iid);
        const sourceArtifactId = `gitlab-issue:${project.pathWithNamespace}#${issue.iid}`;
        const chunks: GitlabProseChunkPayload[] = [];
        chunks.push({
          externalId: `${sourceArtifactId}:body`,
          kind: 'gitlab-issue',
          content: `# ${issue.title}\n\n${issue.description ?? ''}`,
          metadata: {
            project_id: project.id,
            project_path: project.pathWithNamespace,
            issue_iid: issue.iid,
            state: issue.state,
            web_url: issue.web_url,
            kind: 'body',
          },
          aclSubjects: acl,
          sourceArtifactId,
        });
        for (const n of notes) {
          if (n.system) continue;
          if (!n.body || n.body.trim().length === 0) continue;
          chunks.push({
            externalId: `${sourceArtifactId}:note:${n.id}`,
            kind: 'gitlab-issue',
            content: `${n.author.username}: ${n.body}`,
            metadata: {
              project_id: project.id,
              project_path: project.pathWithNamespace,
              issue_iid: issue.iid,
              note_id: n.id,
              kind: 'note',
            },
            aclSubjects: acl,
            sourceArtifactId,
          });
        }
        await enqueueEmbed({ chunks });
        artifactCount += 1;
        if (issue.updated_at > highestUpdatedAt) highestUpdatedAt = issue.updated_at;
      }
    } catch (err) {
      logger?.warn({ msg: 'gitlab-issue-sync project failed', project: project.pathWithNamespace, err: String(err) });
    }

    if (highestUpdatedAt) perProjectUpdatedAt[projectKey] = highestUpdatedAt;
    logger?.info({ msg: 'gitlab-prose project done', project: project.pathWithNamespace, watermark: highestUpdatedAt });
  }

  return {
    artifactCount,
    updatedMetadata: { per_project_updated_at: perProjectUpdatedAt },
  };
}

async function fetchReadme(
  client: GitlabApiClient,
  projectId: number,
  ref: string,
): Promise<{ path: string; content: string } | null> {
  for (const candidate of README_CANDIDATES) {
    const content = await client.getFileRaw(projectId, candidate, ref);
    if (content !== null && content.length > 0) return { path: candidate, content };
  }
  return null;
}
