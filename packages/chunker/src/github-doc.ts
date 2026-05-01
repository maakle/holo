import type { Chunker, Chunk, ChunkContext } from './contract.js';
import { recursiveSplit } from './recursive-split.js';

export interface GithubDocInput {
  repoFullName: string;
  filePath: string;
  content: string;
}

export const githubDocChunker: Chunker<GithubDocInput> = {
  kind: 'github-doc',
  embeddingModel: 'openai-3-large',
  async chunk(input: GithubDocInput, ctx: ChunkContext): Promise<Chunk[]> {
    if (input.content.length === 0) return [];

    const parentExternalId = `doc:${input.repoFullName}:${input.filePath}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const breadcrumb = `${input.repoFullName} / ${input.filePath}`;

    const pieces = recursiveSplit(input.content, { chunkSize: 1200, overlap: 150 });

    return pieces.map((text) => ({
      content: `${breadcrumb}\n\n${text}`,
      parentExternalId,
      metadata: {
        repo_full_name: input.repoFullName,
        file_path: input.filePath,
        breadcrumb,
      },
      aclSubjects,
    }));
  },
};
