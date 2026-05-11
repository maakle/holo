import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';
import { adfToPlainText } from './adf';
import type { JiraIssue, JiraProject } from './types';

function buildIssueBrowseUrl(siteUrl: string, key: string): string {
  return `${siteUrl}/browse/${key}`;
}

function buildProjectUrl(siteUrl: string, key: string): string {
  return `${siteUrl}/jira/projects/${key}`;
}

function projectIssueToContent(issue: JiraIssue): string {
  const f = issue.fields;
  const lines: string[] = [];
  lines.push(`[${issue.key}] ${f.summary}`);

  const meta: string[] = [];
  meta.push(`Status: ${f.status.name}`);
  meta.push(`Type: ${f.issuetype.name}`);
  if (f.priority?.name) meta.push(`Priority: ${f.priority.name}`);
  if (f.assignee?.displayName) meta.push(`Assignee: ${f.assignee.displayName}`);
  meta.push(`Project: ${f.project.name}`);
  if (f.labels && f.labels.length > 0) meta.push(`Labels: ${f.labels.join(', ')}`);
  lines.push(meta.join(' · '));

  const description = adfToPlainText(f.description).trim();
  if (description.length > 0) {
    lines.push('');
    lines.push(description);
  }
  return lines.join('\n');
}

function aclFor(issue: JiraIssue): string[] {
  return [`jira:project:${issue.fields.project.id}`, 'jira:org'];
}

function issueMetadata(issue: JiraIssue, siteUrl: string): Record<string, unknown> {
  const f = issue.fields;
  return {
    key: issue.key,
    url: buildIssueBrowseUrl(siteUrl, issue.key),
    projectKey: f.project.key,
    projectId: f.project.id,
    statusName: f.status.name,
    statusCategory: f.status.statusCategory?.key ?? null,
    issueTypeName: f.issuetype.name,
    priority: f.priority?.name ?? null,
    assigneeId: f.assignee?.accountId ?? null,
    reporterId: f.reporter?.accountId ?? null,
    labels: f.labels ?? [],
    createdAt: f.created,
    updatedAt: f.updated,
  };
}

/**
 * Emit one `jira-issue` chunk + one `jira-comment` chunk per top-level
 * comment. All chunks share the parent issue's source-artifact id so
 * deletions of the issue cascade to its comment chunks.
 */
export async function processIssue(
  ctx: ResourceSyncContext<unknown>,
  issue: JiraIssue,
  siteUrl: string,
): Promise<void> {
  const sourceArtifactId = `jira-issue:${issue.id}`;
  const acl = aclFor(issue);

  const issueChunk: ChunkUpsert = {
    externalId: issue.id,
    kind: 'jira-issue',
    content: projectIssueToContent(issue),
    aclSubjects: acl,
    metadata: issueMetadata(issue, siteUrl),
    sourceArtifactId,
  };
  await ctx.upsert(issueChunk);

  const comments = issue.fields.comment?.comments ?? [];
  for (const c of comments) {
    const body = adfToPlainText(c.body).trim();
    const author = c.author?.displayName ?? 'Unknown';
    const header = `Comment by ${author} · ${c.created}`;
    const content = body.length > 0 ? `${header}\n\n${body}` : header;
    const commentChunk: ChunkUpsert = {
      externalId: `${issue.id}:${c.id}`,
      kind: 'jira-comment',
      content,
      aclSubjects: acl,
      metadata: {
        commentId: c.id,
        issueKey: issue.key,
        issueId: issue.id,
        projectId: issue.fields.project.id,
        authorId: c.author?.accountId ?? null,
        createdAt: c.created,
        updatedAt: c.updated,
      },
      sourceArtifactId,
    };
    await ctx.upsert(commentChunk);
  }
}

function projectProjectToContent(project: JiraProject): string {
  const lines: string[] = [];
  lines.push(`[${project.key}] ${project.name}`);

  const meta: string[] = [];
  if (project.projectTypeKey) meta.push(`Type: ${project.projectTypeKey}`);
  if (project.lead?.displayName) meta.push(`Lead: ${project.lead.displayName}`);
  if (meta.length > 0) lines.push(meta.join(' · '));

  const description = (project.description ?? '').trim();
  if (description.length > 0) {
    lines.push('');
    lines.push(description);
  }
  return lines.join('\n');
}

export async function processProject(
  ctx: ResourceSyncContext<unknown>,
  project: JiraProject,
  siteUrl: string,
): Promise<void> {
  const chunk: ChunkUpsert = {
    externalId: project.id,
    kind: 'jira-project',
    content: projectProjectToContent(project),
    aclSubjects: ['jira:org'],
    metadata: {
      key: project.key,
      name: project.name,
      projectTypeKey: project.projectTypeKey ?? null,
      leadId: project.lead?.accountId ?? null,
      url: buildProjectUrl(siteUrl, project.key),
    },
  };
  await ctx.upsert(chunk);
}
