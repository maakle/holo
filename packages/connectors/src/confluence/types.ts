/**
 * Narrowly-typed shapes for the Confluence Cloud REST v1 endpoints we call.
 * Only fields we project into chunks or metadata are typed.
 *
 * Endpoints:
 *  - GET  /wiki/rest/api/user/current        (testConnection)
 *  - GET  /wiki/_edge/tenant_info            (cloudId for sources.externalId)
 *  - GET  /wiki/rest/api/space               (spaces, start/limit pagination)
 *  - GET  /wiki/rest/api/content/search      (CQL: pages + comments, incremental)
 */

export interface ConfluenceCurrentUser {
  accountId: string;
  email?: string;
  displayName: string;
}

export interface ConfluenceTenantInfo {
  cloudId: string;
  cloudName?: string;
}

export interface ConfluenceUserRef {
  accountId: string;
  displayName: string;
  email?: string;
}

export interface ConfluenceSpaceDescription {
  plain?: { value: string };
}

export interface ConfluenceSpace {
  id: string | number;
  key: string;
  name: string;
  type?: string;
  description?: ConfluenceSpaceDescription;
}

export interface ConfluenceSpacesPage {
  results: ConfluenceSpace[];
  start: number;
  limit: number;
  size: number;
  _links?: { next?: string };
}

export interface ConfluenceBody {
  /**
   * v1 returns ADF as a string-encoded JSON document under
   * `body.atlas_doc_format.value`. Callers must JSON.parse before flattening.
   */
  atlas_doc_format?: { value: string; representation: 'atlas_doc_format' };
}

export interface ConfluenceVersion {
  number?: number;
  /** ISO-8601 timestamp of the latest edit. */
  when: string;
  by?: ConfluenceUserRef;
}

export interface ConfluenceAncestor {
  id: string;
  title?: string;
}

export interface ConfluenceCommentExtensions {
  /** "inline" for inline comments, "footer" for page-level comments. */
  location?: 'inline' | 'footer';
}

export interface ConfluenceComment {
  id: string;
  type: 'comment';
  title?: string;
  body?: ConfluenceBody;
  version?: ConfluenceVersion;
  history?: { createdBy?: ConfluenceUserRef; createdDate?: string };
  extensions?: ConfluenceCommentExtensions;
}

export interface ConfluenceCommentsContainer {
  results: ConfluenceComment[];
}

export interface ConfluencePageChildren {
  comment?: ConfluenceCommentsContainer;
}

export interface ConfluencePage {
  id: string;
  type: 'page' | 'blogpost';
  title: string;
  status?: string;
  space?: { id: string | number; key: string; name?: string };
  body?: ConfluenceBody;
  version?: ConfluenceVersion;
  history?: { createdBy?: ConfluenceUserRef; createdDate?: string };
  ancestors?: ConfluenceAncestor[];
  children?: ConfluencePageChildren;
  _links?: { webui?: string; tinyui?: string };
}

export interface ConfluenceContentSearchResponse {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
  totalSize?: number;
  _links?: { next?: string; base?: string };
}
