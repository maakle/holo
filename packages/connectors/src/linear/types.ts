/**
 * Response types for the Linear GraphQL queries we issue. Narrow on purpose
 * — only the fields we actually project into chunks/metadata are typed.
 */

export interface LinearViewer {
  id: string;
  name: string;
  email: string;
  organization: {
    id: string;
    name: string;
    urlKey: string;
  };
}

export interface LinearViewerResponse {
  viewer: LinearViewer;
}

export interface LinearIssueState {
  id: string;
  name: string;
  type: string;
}

export interface LinearIssueAssignee {
  id: string;
  name: string;
  email: string;
}

export interface LinearIssueTeam {
  id: string;
  name: string;
  key: string;
}

export interface LinearIssueProject {
  id: string;
  name: string;
}

export interface LinearIssueLabel {
  id: string;
  name: string;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  priorityLabel: string;
  createdAt: string;
  updatedAt: string;
  state: LinearIssueState;
  assignee: LinearIssueAssignee | null;
  team: LinearIssueTeam;
  project: LinearIssueProject | null;
  labels: { nodes: LinearIssueLabel[] };
}

export interface LinearPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface LinearIssuesResponse {
  issues: {
    pageInfo: LinearPageInfo;
    nodes: LinearIssue[];
  };
}

/**
 * Linear's GraphQL transport returns errors in the standard `errors` array.
 * The framework's HTTP client only checks transport-level status codes, so
 * the spec needs to inspect the JSON envelope itself.
 */
export interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}
