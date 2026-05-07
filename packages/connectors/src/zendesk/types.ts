/**
 * Zendesk Help Center API response shapes — projected to the fields the
 * spec actually reads. The full API surface is documented at
 * https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/
 */

export interface ZendeskArticle {
  id: number;
  url: string;
  html_url: string;
  /** Locale code, e.g. `en-us`. */
  locale: string;
  source_locale: string;
  title: string;
  /** HTML body — needs `stripHtmlToText` before chunking. */
  body: string;
  /** Section this article belongs to (-> ZendeskSection.id). */
  section_id: number | null;
  author_id: number;
  outdated: boolean;
  draft: boolean;
  /** ISO timestamp the article was last updated. */
  updated_at: string;
  created_at: string;
  /** Sum of upvotes minus downvotes; useful as a ranking signal later. */
  vote_sum?: number;
  vote_count?: number;
}

export interface ZendeskSection {
  id: number;
  category_id: number | null;
  name: string;
  description?: string;
  locale: string;
  html_url: string;
}

export interface ZendeskCategory {
  id: number;
  name: string;
  description?: string;
  locale: string;
  html_url: string;
}

export interface ZendeskArticlesPage {
  articles: ZendeskArticle[];
  next_page: string | null;
  count?: number;
}

export interface ZendeskSectionsPage {
  sections: ZendeskSection[];
  next_page: string | null;
}

export interface ZendeskCategoriesPage {
  categories: ZendeskCategory[];
  next_page: string | null;
}
