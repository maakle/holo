import type { Chunker, Chunk, ChunkContext } from './contract.js';
import { recursiveSplit } from './recursive-split.js';
import { astChunk } from './tree-sitter/index.js';
import { holoError, ErrorCode } from '@holo/errors';

export interface GithubCodeInput {
  repoFullName: string;
  commitSha: string;
  filePath: string;
  language: string;
  content: string;
}

function lineRangeForOffsets(
  content: string,
  startOffset: number,
  endOffset: number,
): { startLine: number; endLine: number } {
  let startLine = 1;
  let endLine = 1;
  for (let i = 0; i < startOffset && i < content.length; i++) {
    if (content[i] === '\n') startLine++;
  }
  endLine = startLine;
  for (let i = startOffset; i < endOffset && i < content.length; i++) {
    if (content[i] === '\n') endLine++;
  }
  return { startLine, endLine };
}

export const githubCodeChunker: Chunker<GithubCodeInput> = {
  kind: 'github-code',
  embeddingModel: 'voyage-code-3',
  async chunk(input: GithubCodeInput, ctx: ChunkContext): Promise<Chunk[]> {
    if (!ctx.treeSitter) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'github-code chunker requires ctx.treeSitter to be provided',
        fix: 'Pass a TreeSitterRegistry instance in the chunk context.',
      });
    }

    const parentExternalId = `code:${input.repoFullName}:${input.commitSha}:${input.filePath}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMeta = {
      repo_full_name: input.repoFullName,
      commit_sha: input.commitSha,
      file_path: input.filePath,
      language: input.language,
    };

    const node = await ctx.treeSitter.parse(input.language, input.content);

    if (node) {
      const ast = astChunk(node, { maxTokens: 1200, overlap: 150 });
      return ast.map((a) => ({
        content: a.content,
        parentExternalId,
        metadata: {
          ...baseMeta,
          ...(a.symbolName !== undefined ? { symbol_name: a.symbolName } : {}),
          start_line: a.startLine,
          end_line: a.endLine,
        },
        aclSubjects,
      }));
    }

    // Fallback: recursive split, then compute line ranges by counting newlines.
    console.warn(
      JSON.stringify({
        event: 'HOLO_CHUNKER_FALLBACK',
        language: input.language,
        filePath: input.filePath,
        repoFullName: input.repoFullName,
        commitSha: input.commitSha,
      }),
    );

    const pieces = recursiveSplit(input.content, { chunkSize: 4800, overlap: 600 });
    const chunks: Chunk[] = [];
    let cursor = 0;
    for (const piece of pieces) {
      const offset = input.content.indexOf(piece, cursor);
      const startOffset = offset >= 0 ? offset : cursor;
      const endOffset = startOffset + piece.length;
      cursor = endOffset;
      const { startLine, endLine } = lineRangeForOffsets(input.content, startOffset, endOffset);
      chunks.push({
        content: piece,
        parentExternalId,
        metadata: { ...baseMeta, start_line: startLine, end_line: endLine },
        aclSubjects,
      });
    }
    return chunks;
  },
};
