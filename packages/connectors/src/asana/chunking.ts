/**
 * Asana task → chunk projection. Asana tasks are typically short, so we emit
 * one chunk per task: title + a metadata header line + notes body. Mirrors
 * the Linear projection so retrieval renders consistently in the UI.
 */
import type { ResourceSyncContext } from '@holo/connector-framework';
import type { AsanaTask } from './types';

function projectTaskToContent(task: AsanaTask): string {
  const lines: string[] = [];
  const checkbox = task.completed ? '[x]' : '[ ]';
  lines.push(`${checkbox} ${task.name}`);

  const meta: string[] = [];
  meta.push(`Status: ${task.completed ? 'Completed' : 'Open'}`);
  if (task.projects.length > 0) {
    meta.push(`Projects: ${task.projects.map((p) => p.name).join(', ')}`);
  }
  if (task.assignee) meta.push(`Assignee: ${task.assignee.name}`);
  if (task.due_on) meta.push(`Due: ${task.due_on}`);
  if (task.parent) meta.push(`Parent: ${task.parent.name}`);
  if (task.tags && task.tags.length > 0) {
    meta.push(`Tags: ${task.tags.map((t) => t.name).join(', ')}`);
  }
  if (meta.length > 0) lines.push(meta.join(' · '));

  if (task.notes && task.notes.trim().length > 0) {
    lines.push('');
    lines.push(task.notes.trim());
  }
  return lines.join('\n');
}

function aclSubjectsFor(
  task: AsanaTask,
  workspaceGid: string,
  organizationId: string,
): string[] {
  // Asana PAT is workspace-scope → whole-org read access. The `org:${id}`
  // subject is what Files panel + RAG retrieval check; workspace + project
  // subjects keep future scoping options open.
  const subjects = [`org:${organizationId}`, `asana:workspace:${workspaceGid}`, 'asana:org'];
  for (const project of task.projects) {
    subjects.push(`asana:project:${project.gid}`);
  }
  return subjects;
}

/** Emit one chunk for an Asana task via ctx.upsert. */
export async function processTask(
  ctx: ResourceSyncContext<unknown>,
  task: AsanaTask,
  workspaceGid: string,
): Promise<void> {
  await ctx.upsert({
    externalId: task.gid,
    kind: 'asana-task',
    content: projectTaskToContent(task),
    aclSubjects: aclSubjectsFor(task, workspaceGid, ctx.organizationId),
    metadata: {
      url: task.permalink_url,
      workspaceGid,
      projectIds: task.projects.map((p) => p.gid),
      projectNames: task.projects.map((p) => p.name),
      assigneeId: task.assignee?.gid ?? null,
      assigneeName: task.assignee?.name ?? null,
      completed: task.completed,
      completedAt: task.completed_at,
      dueOn: task.due_on,
      dueAt: task.due_at,
      createdAt: task.created_at,
      modifiedAt: task.modified_at,
      parentId: task.parent?.gid ?? null,
      tags: task.tags?.map((t) => t.name) ?? [],
    },
  });
}
