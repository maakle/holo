/**
 * Mintlify is consumed via two public-by-default surfaces:
 *
 *   1. `<base-url>/llms.txt` — auto-published by every Mintlify site.
 *      A markdown file with a top-level title + description, then sections
 *      of `[title](path): description` bullets pointing at each page.
 *      This is THE designed-for-LLMs index path; we parse it as the page list.
 *
 *   2. `<base-url><path>.md` — every page on a Mintlify site has a `.md`
 *      twin that returns the page's markdown source instead of HTML.
 *      That's what we ingest and chunk.
 *
 * For OpenAPI (the second resource), we probe a small set of conventional
 * paths (`/openapi.json`, `/api-reference/openapi.json`, …) and ingest
 * the spec if any of them respond.
 */

export interface LlmsIndexEntry {
  /** Page title from the bullet's link text. */
  title: string;
  /** Page path (e.g. `/introduction`). Always starts with `/`. */
  path: string;
  /** Section heading the bullet appeared under (`""` if top-level). */
  section: string;
  /** Free-text description after the link, if present. */
  description?: string;
}

export interface LlmsIndex {
  /** Site-level title (`# Foo` line at the top of llms.txt). */
  title: string;
  /** Site-level blockquote description (`> Foo` line) if present. */
  description?: string;
  /** Flat list of pages discovered, in document order. */
  pages: LlmsIndexEntry[];
}
