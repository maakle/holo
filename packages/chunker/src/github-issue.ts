import type { Chunker, Chunk, ChunkContext } from './contract';

export interface GithubIssueInput {
  issueNumber: number;
  repoFullName: string;
  title: string;
  body: string;
  comments: Array<{ author: string; body: string }>;
}

export const githubIssueChunker: Chunker<GithubIssueInput> = {
  kind: 'github-issue',
  embeddingModel: 'openai-3-small',
  async chunk(input: GithubIssueInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `issue:${input.repoFullName}#${input.issueNumber}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMeta = {
      issue_number: input.issueNumber,
      repo_full_name: input.repoFullName,
    };

    const chunks: Chunk[] = [
      {
        content: `# ${input.title}\n\n${input.body}`,
        parentExternalId,
        metadata: { ...baseMeta, kind: 'body' },
        aclSubjects,
      },
    ];

    for (const c of input.comments) {
      chunks.push({
        content: `${c.author}: ${c.body}`,
        parentExternalId,
        metadata: { ...baseMeta, kind: 'comment' },
        aclSubjects,
      });
    }

    return chunks;
  },
};
