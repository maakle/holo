import type { Chunker, Chunk, ChunkContext } from './contract';

export interface GithubPrInput {
  prNumber: number;
  repoFullName: string;
  title: string;
  body: string;
  linkedIssue?: { number: number; title: string; body: string };
  files: Array<{ path: string; patch: string }>;
  reviews: Array<{
    author: string;
    body: string;
    comments: Array<{ author: string; path: string; body: string; line: number }>;
  }>;
}

const DIFF_CHAR_BUDGET = 24_000;

function buildTitleContent(input: GithubPrInput): string {
  let s = `# ${input.title}\n\n${input.body}`;
  if (input.linkedIssue) {
    s += `\n\n---\nLinked issue #${input.linkedIssue.number}: ${input.linkedIssue.title}\n\n${input.linkedIssue.body}`;
  }
  return s;
}

function buildDiffContent(input: GithubPrInput): string {
  const parts = input.files.map((f) => `${f.path}:\n${f.patch}\n\n`);
  let combined = parts.join('');
  if (combined.length > DIFF_CHAR_BUDGET) {
    // Truncate per-file proportionally
    const ratio = DIFF_CHAR_BUDGET / combined.length;
    const truncated = input.files.map((f) => {
      const header = `${f.path}:\n`;
      const budget = Math.max(0, Math.floor((f.patch.length * ratio) - header.length));
      return `${header}${f.patch.slice(0, budget)}\n\n`;
    });
    combined = truncated.join('') + '\n[truncated]';
  }
  return combined;
}

function buildReviewContent(input: GithubPrInput): string {
  return input.reviews
    .map((r) => {
      let out = `${r.author}: ${r.body}\n`;
      for (const c of r.comments) {
        out += `  ${c.author} [${c.path}:${c.line}]: ${c.body}\n`;
      }
      return out;
    })
    .join('');
}

export const githubPrChunker: Chunker<GithubPrInput> = {
  kind: 'github-pr',
  embeddingModel: 'openai-3-small',
  async chunk(input: GithubPrInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `pr:${input.repoFullName}#${input.prNumber}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMeta = {
      pr_number: input.prNumber,
      repo_full_name: input.repoFullName,
    };

    const chunks: Chunk[] = [
      {
        content: buildTitleContent(input),
        parentExternalId,
        metadata: { ...baseMeta, kind: 'title' },
        aclSubjects,
      },
      {
        content: buildDiffContent(input),
        parentExternalId,
        metadata: { ...baseMeta, kind: 'diff' },
        aclSubjects,
      },
    ];

    if (input.reviews.length > 0) {
      chunks.push({
        content: buildReviewContent(input),
        parentExternalId,
        metadata: { ...baseMeta, kind: 'review' },
        aclSubjects,
      });
    }

    return chunks;
  },
};
