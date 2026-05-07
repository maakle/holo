/**
 * Notion API response shapes — narrow projections of the v1 API surface,
 * limited to the fields the spec actually reads.
 */

export interface NotionPage {
  id: string;
  archived: boolean;
  last_edited_time: string;
  last_edited_by?: { id: string; name?: string };
  parent:
    | { type: 'workspace'; workspace: true }
    | { type: 'page_id'; page_id: string }
    | { type: 'database_id'; database_id: string };
  properties?: Record<string, unknown>;
  url?: string;
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  /** Per-block-type inline payload (e.g. `paragraph: { rich_text: [...] }`). */
  [key: string]: unknown;
}

export interface NotionViewer {
  id: string;
  name?: string;
  workspace_name?: string;
}

export interface NotionPageList {
  results: NotionPage[];
  next_cursor?: string | null;
  has_more?: boolean;
}

export interface NotionBlockList {
  results: NotionBlock[];
  next_cursor?: string | null;
  has_more?: boolean;
}
