/**
 * Asana REST helpers built on the framework's HttpClient.
 *
 * Asana wraps payloads in `{ data, next_page }`. Pagination is offset-based:
 * pass `offset=<next_page.offset>` to continue. `limit` is capped at 100.
 */
import type { HttpClient } from '@holo/connector-framework';
import type {
  AsanaEnvelope,
  AsanaProject,
  AsanaTask,
  AsanaUserMe,
  AsanaWorkspace,
} from './types';

const TASK_OPT_FIELDS = [
  'gid',
  'name',
  'notes',
  'due_on',
  'due_at',
  'completed',
  'completed_at',
  'created_at',
  'modified_at',
  'permalink_url',
  'assignee.gid',
  'assignee.name',
  'assignee.email',
  'projects.gid',
  'projects.name',
  'workspace.gid',
  'workspace.name',
  'memberships.section.name',
  'memberships.project.name',
  'tags.name',
  'parent.gid',
  'parent.name',
].join(',');

const PROJECT_OPT_FIELDS = ['gid', 'name'].join(',');

function buildQuery(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    usp.set(k, String(v));
  }
  const s = usp.toString();
  return s.length > 0 ? `?${s}` : '';
}

export async function getUserMe(api: HttpClient): Promise<AsanaUserMe> {
  const env = await api.get<AsanaEnvelope<AsanaUserMe>>('/users/me');
  return env.data;
}

export async function listWorkspaces(api: HttpClient): Promise<AsanaWorkspace[]> {
  const env = await api.get<AsanaEnvelope<AsanaWorkspace[]>>('/workspaces?limit=100');
  return env.data;
}

export async function listProjectsPage(
  api: HttpClient,
  opts: { workspaceGid: string; offset?: string },
): Promise<AsanaEnvelope<AsanaProject[]>> {
  const query = buildQuery({
    limit: 100,
    offset: opts.offset,
    opt_fields: PROJECT_OPT_FIELDS,
    archived: 'false',
  });
  return api.get<AsanaEnvelope<AsanaProject[]>>(
    `/workspaces/${opts.workspaceGid}/projects${query}`,
  );
}

export async function listTasksPage(
  api: HttpClient,
  opts: { projectGid: string; modifiedSince?: string; offset?: string },
): Promise<AsanaEnvelope<AsanaTask[]>> {
  const query = buildQuery({
    project: opts.projectGid,
    limit: 100,
    offset: opts.offset,
    modified_since: opts.modifiedSince,
    opt_fields: TASK_OPT_FIELDS,
  });
  return api.get<AsanaEnvelope<AsanaTask[]>>(`/tasks${query}`);
}
