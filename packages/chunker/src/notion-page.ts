import type { Chunker, Chunk, ChunkContext } from './contract.js';

export interface NotionPageInput {
  pageId: string;
  databaseId?: string;
  breadcrumb: string[];
  blocks: Array<{ blockId: string; type: string; text: string }>;
  lastEditedByUser: string;
  lastEditedTime: string;
  rootPageId: string;
}

const PAGE_SUMMARY_CHAR_CAP = 12_000;
const TRUNCATION_MARKER = '\n[truncated]';

export const notionPageChunker: Chunker<NotionPageInput> = {
  kind: 'notion-page',
  embeddingModel: 'openai-3-large',
  async chunk(input: NotionPageInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `notion-page:${input.pageId}`;
    const aclSubjects = [
      `org:${ctx.organizationId}`,
      `notion-page-tree:${input.rootPageId}`,
    ];
    const breadcrumbStr = input.breadcrumb.join(' / ');
    const baseMeta = {
      notion_page_id: input.pageId,
      ...(input.databaseId !== undefined ? { notion_database_id: input.databaseId } : {}),
      breadcrumb: breadcrumbStr,
      last_edited_by_user: input.lastEditedByUser,
      last_edited_time: input.lastEditedTime,
    };

    const chunks: Chunk[] = [];
    const nonEmptyBlocks = input.blocks.filter((b) => b.text.trim().length > 0);

    for (const block of nonEmptyBlocks) {
      chunks.push({
        content: `${breadcrumbStr} / ${block.type}\n${block.text}`,
        parentExternalId,
        metadata: {
          ...baseMeta,
          block_id: block.blockId,
          kind: 'block',
        },
        aclSubjects,
      });
    }

    // Page summary chunk if total blocks > 3 (uses input.blocks count, not nonEmpty).
    if (input.blocks.length > 3) {
      const header = `${breadcrumbStr}\n\n`;
      let body = '';
      let truncated = false;
      for (const block of input.blocks) {
        const line = `${block.type}: ${block.text}\n`;
        if (header.length + body.length + line.length > PAGE_SUMMARY_CHAR_CAP) {
          truncated = true;
          break;
        }
        body += line;
      }
      let content = header + body;
      if (truncated) content += TRUNCATION_MARKER;
      chunks.push({
        content,
        parentExternalId,
        metadata: { ...baseMeta, kind: 'page' },
        aclSubjects,
      });
    }

    return chunks;
  },
};
