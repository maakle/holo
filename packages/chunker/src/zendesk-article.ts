import type { Chunk, ChunkContext, Chunker } from './contract';
import { recursiveSplit } from './recursive-split';

export interface ZendeskArticleInput {
  /** Help-center base URL (e.g. `https://help.kombo.dev`). */
  baseUrl: string;
  /** Stable Zendesk article id. */
  articleId: number;
  /** Article title. */
  title: string;
  /** Public-facing article URL (`html_url` from the API). */
  htmlUrl: string;
  /** Locale code (e.g. `en-us`). */
  locale: string;
  /** Section name from the help center hierarchy ("" if unknown). */
  section: string;
  /** Category name above the section ("" if unknown). */
  category: string;
  /** ISO timestamp from `updated_at`. */
  updatedAt: string;
  /** Article body (HTML, as Zendesk returns it). */
  bodyHtml: string;
  /** Optional vote sum (signal for ranking later). */
  voteSum?: number;
}

const CHUNK_SIZE = 1200;
const OVERLAP = 150;

/**
 * Strip Zendesk article HTML down to readable text. Keeps headings as
 * markdown-ish lines and surfaces `<a href>` URLs inline so retrieval can
 * still match link targets, but discards everything else (style, script,
 * attributes). A real HTML→markdown pass would preserve more structure
 * but adds a dependency; this string-level pass covers ~95% of what
 * Zendesk articles actually contain.
 */
export function stripHtmlToText(html: string): string {
  let s = html;
  // Drop scripts/styles entirely.
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Headings → markdown.
  s = s.replace(/<h([1-6])[^>]*>(.*?)<\/h\1>/gi, (_m, level, body) => {
    const hashes = '#'.repeat(Number(level));
    return `\n\n${hashes} ${body}\n\n`;
  });
  // Lists.
  s = s.replace(/<li[^>]*>(.*?)<\/li>/gi, '\n- $1');
  s = s.replace(/<\/?ul[^>]*>/gi, '\n');
  s = s.replace(/<\/?ol[^>]*>/gi, '\n');
  // Paragraphs / breaks.
  s = s.replace(/<\/p>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // Anchors: keep "label (url)".
  s = s.replace(
    /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi,
    (_m, href, label) => `${label} (${href})`,
  );
  // Inline code/pre — preserve content with simple wrappers.
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n\n```\n$1\n```\n\n');
  s = s.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  // Strip any remaining tags.
  s = s.replace(/<[^>]+>/g, '');
  // HTML entities — keep this short; a full table is overkill.
  s = s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse runs of blank lines + trim.
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

export const zendeskArticleChunker: Chunker<ZendeskArticleInput> = {
  kind: 'zendesk-article',
  embeddingModel: 'openai-3-small',
  async chunk(input: ZendeskArticleInput, ctx: ChunkContext): Promise<Chunk[]> {
    const text = stripHtmlToText(input.bodyHtml);
    if (text.length === 0) return [];

    const aclSubjects = [`org:${ctx.organizationId}`];
    const breadcrumbParts = [input.category, input.section, input.title].filter(
      (s) => s.length > 0,
    );
    const breadcrumb = breadcrumbParts.join(' / ');

    // Prefix the article title + URL on the FIRST line of every chunk so
    // retrieval matches against both content and source.
    const prefix = `${breadcrumb}\n${input.htmlUrl}\n`;

    const pieces = recursiveSplit(text, {
      chunkSize: CHUNK_SIZE,
      overlap: OVERLAP,
    });

    return pieces.map((piece, idx) => ({
      content: `${prefix}\n${piece}`,
      parentExternalId: ctx.sourceArtifactId,
      metadata: {
        article_id: input.articleId,
        title: input.title,
        url: input.htmlUrl,
        locale: input.locale,
        section: input.section,
        category: input.category,
        updated_at: input.updatedAt,
        vote_sum: input.voteSum ?? null,
        chunk_index: idx,
        chunk_count: pieces.length,
      },
      aclSubjects,
    }));
  },
};
