/**
 * Narrowly-typed shapes for the Jira Cloud REST v3 endpoints we call.
 * Only fields we project into chunks or metadata are typed — every
 * unused field is omitted on purpose so the surface stays small.
 *
 * Endpoints:
 *  - POST /rest/api/3/search/jql          (issues + inline comments)
 *  - GET  /rest/api/3/project/search       (projects, paginated)
 *  - GET  /rest/api/3/myself               (testConnection / connect-route validation)
 *  - GET  /rest/api/3/serverInfo           (cloudId for sources.externalId)
 */

export interface JiraMyself {
  accountId: string;
  emailAddress?: string;
  displayName: string;
}

export interface JiraServerInfo {
  baseUrl: string;
  /** Cloud-only field; absent on Jira Server. We only support Cloud. */
  serverTitle?: string;
  cloudId?: string;
  version?: string;
}

export interface JiraUserRef {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  statusCategory?: { key: string; name: string };
}

export interface JiraIssueType {
  id: string;
  name: string;
}

export interface JiraPriority {
  id: string;
  name: string;
}

export interface JiraProjectRef {
  id: string;
  key: string;
  name: string;
}

export interface JiraComment {
  id: string;
  author?: JiraUserRef;
  body?: unknown; // ADF document
  created: string;
  updated: string;
}

export interface JiraIssueFields {
  summary: string;
  description?: unknown; // ADF document or null
  status: JiraStatus;
  issuetype: JiraIssueType;
  priority?: JiraPriority | null;
  assignee?: JiraUserRef | null;
  reporter?: JiraUserRef | null;
  project: JiraProjectRef;
  labels?: string[];
  created: string;
  updated: string;
  comment?: { comments: JiraComment[]; total?: number };
}

export interface JiraIssue {
  id: string;
  key: string;
  /** Self URL — useful for building the user-facing browse link. */
  self: string;
  fields: JiraIssueFields;
}

/**
 * Response shape for POST /rest/api/3/search/jql.
 * Atlassian retired `startAt`/`maxResults` here in favor of opaque
 * `nextPageToken`; `isLast` is the terminal signal.
 */
export interface JiraIssueSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  description?: string;
  lead?: JiraUserRef;
  self?: string;
}

/**
 * Response shape for GET /rest/api/3/project/search.
 * Page-based with `isLast` for termination.
 */
export interface JiraProjectSearchResponse {
  values: JiraProject[];
  startAt: number;
  maxResults: number;
  total?: number;
  isLast: boolean;
}
