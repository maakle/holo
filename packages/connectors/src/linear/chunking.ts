/**
 * Linear issue → chunk projection. Linear issues are typically short, so we
 * emit one chunk per issue and keep the title + status row + body together
 * in the chunk content.
 */
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { LinearIssue } from './types';

function projectIssueToContent(issue: LinearIssue): string {
  const lines: string[] = [];
  lines.push(`[${issue.identifier}] ${issue.title}`);

  const meta: string[] = [];
  meta.push(`Status: ${issue.state.name}`);
  if (issue.priorityLabel) meta.push(`Priority: ${issue.priorityLabel}`);
  meta.push(`Team: ${issue.team.name}`);
  if (issue.project) meta.push(`Project: ${issue.project.name}`);
  if (issue.assignee) meta.push(`Assignee: ${issue.assignee.name}`);
  if (issue.labels.nodes.length > 0) {
    meta.push(`Labels: ${issue.labels.nodes.map((l) => l.name).join(', ')}`);
  }
  lines.push(meta.join(' · '));

  if (issue.description && issue.description.trim().length > 0) {
    lines.push('');
    lines.push(issue.description.trim());
  }
  return lines.join('\n');
}

function aclSubjectsFor(issue: LinearIssue): string[] {
  // Linear has no per-issue ACL on the API; team-id keeps a future option
  // open for "what was your team working on?" without leaking other teams.
  return [`linear:team:${issue.team.id}`, `linear:org`];
}

/** Emit one chunk for a Linear issue via ctx.upsert. */
export async function processIssue(
  ctx: ResourceSyncContext<unknown>,
  issue: LinearIssue,
): Promise<void> {
  await ctx.upsert({
    externalId: issue.id,
    kind: 'linear-issue',
    content: projectIssueToContent(issue),
    aclSubjects: aclSubjectsFor(issue),
    metadata: {
      identifier: issue.identifier,
      url: issue.url,
      state: issue.state.name,
      stateType: issue.state.type,
      teamKey: issue.team.key,
      teamId: issue.team.id,
      projectId: issue.project?.id ?? null,
      assigneeId: issue.assignee?.id ?? null,
      priority: issue.priority,
      priorityLabel: issue.priorityLabel,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      labels: issue.labels.nodes.map((l) => l.name),
    },
  });
}
