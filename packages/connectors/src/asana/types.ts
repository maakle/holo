/**
 * Response types for the Asana REST endpoints we issue. Narrow on purpose —
 * only the fields we actually project into chunks/metadata are typed.
 *
 * Asana wraps every response in a top-level `data` envelope and uses
 * `next_page.offset` for pagination tokens.
 */

export interface AsanaWorkspace {
  gid: string;
  name: string;
  resource_type?: string;
}

export interface AsanaUserMe {
  gid: string;
  name: string;
  email: string;
  workspaces: AsanaWorkspace[];
}

export interface AsanaProject {
  gid: string;
  name: string;
  resource_type?: string;
}

export interface AsanaAssignee {
  gid: string;
  name: string;
  email?: string;
}

export interface AsanaTag {
  gid: string;
  name: string;
}

export interface AsanaMembership {
  project?: { gid: string; name: string } | null;
  section?: { gid: string; name: string } | null;
}

export interface AsanaParent {
  gid: string;
  name: string;
}

export interface AsanaTask {
  gid: string;
  name: string;
  notes: string | null;
  html_notes?: string | null;
  due_on: string | null;
  due_at: string | null;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  modified_at: string;
  permalink_url: string;
  assignee: AsanaAssignee | null;
  projects: AsanaProject[];
  workspace?: AsanaWorkspace | null;
  memberships?: AsanaMembership[];
  tags?: AsanaTag[];
  parent?: AsanaParent | null;
}

export interface AsanaNextPage {
  offset: string;
  path?: string;
  uri?: string;
}

export interface AsanaEnvelope<T> {
  data: T;
  next_page?: AsanaNextPage | null;
}
