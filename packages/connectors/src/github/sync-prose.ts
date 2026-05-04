import {
  githubPrChunker,
  githubIssueChunker,
  githubDocChunker,
} from '@holo/chunker';
import { chunkHash } from '../shared/content-hash';
import { ErrorCode, holoError } from '@holo/errors';
import type {
  GithubApiClient,
  GithubPrReview,
  GithubPrReviewComment,
} from './api-client';
import type { SyncLogger } from './sync-code';

const BATCH_SIZE = 50;
const MAX_PAGES = 20; // 20 × 100 = 2000 items per type per repo per run

export type GithubProseChunkPayload = {
  kind: 'github-pr' | 'github-issue' | 'github-doc';
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  contentHash: string;
  sourceArtifactId: string;
  provider: 'github';
  sourceId: string;
  organizationId: string;
};

export type GithubProseEmbedEnqueueFn = (payload: {
  chunks: GithubProseChunkPayload[];
  organizationId: string;
  sourceId: string;
}) => Promise<void>;

export interface RunGithubProseSyncInput {
  client: GithubApiClient;
  allowedRepos: string[];
  cursorMetadata: Record<string, unknown>;
  organizationId: string;
  sourceId: string;
  existingHashes: Set<string>;
  enqueueEmbed: GithubProseEmbedEnqueueFn;
  logger?: SyncLogger;
}

export interface RunGithubProseSyncOutput {
  artifactCount: number;
  updatedMetadata: Record<string, unknown>;
}

// Parse "Closes #123", "Fixes #42", etc. from PR body
function parseLinkedIssueNumber(body: string | null): number | null {
  if (!body) return null;
  const m = body.match(/(?:closes|fixes|resolves)\s+#(\d+)/i);
  return m?.[1] ? parseInt(m[1], 10) : null;
}

function groupReviewCommentsByReview(
  reviews: GithubPrReview[],
  comments: GithubPrReviewComment[],
): Array<{
  author: string;
  body: string;
  comments: Array<{ author: string; path: string; body: string; line: number }>;
}> {
  return reviews
    .filter((r) => r.body || comments.some(() => true))
    .map((r) => ({
      author: r.user.login,
      body: r.body,
      comments: comments
        .filter(() => true) // all comments associated with this review (simplified)
        .map((c) => ({
          author: c.user.login,
          path: c.path,
          body: c.body,
          line: c.line ?? c.original_line ?? 0,
        })),
    }))
    .filter((r) => r.body || r.comments.length > 0);
}

export async function runGithubProseSync(
  input: RunGithubProseSyncInput,
): Promise<RunGithubProseSyncOutput> {
  if (input.allowedRepos.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
      problem: 'GitHub prose sync has no allowlisted repos',
      fix: 'Add at least one repo to the GitHub allowlist.',
    });
  }

  const logger: SyncLogger = input.logger ?? { info: () => {}, warn: () => {} };
  logger.info({ event: 'github_prose_start', repos: input.allowedRepos });
  const prUpdatedSince = {
    ...((input.cursorMetadata['pr_updated_since'] as Record<string, string>) ?? {}),
  };
  const issueUpdatedSince = {
    ...((input.cursorMetadata['issue_updated_since'] as Record<string, string>) ?? {}),
  };
  const docShas = {
    ...((input.cursorMetadata['doc_shas'] as Record<string, string>) ?? {}),
  };

  const pending: GithubProseChunkPayload[] = [];
  let totalArtifacts = 0;

  const ctx = {
    organizationId: input.organizationId,
    sourceId: input.sourceId,
  };

  const flushBatch = async () => {
    if (pending.length === 0) return;
    for (let i = 0; i < pending.length; i += BATCH_SIZE) {
      await input.enqueueEmbed({
        chunks: pending.slice(i, i + BATCH_SIZE),
        organizationId: input.organizationId,
        sourceId: input.sourceId,
      });
    }
    totalArtifacts += pending.length;
    pending.length = 0;
  };

  const push = (chunk: GithubProseChunkPayload) => {
    if (!input.existingHashes.has(chunk.contentHash)) {
      pending.push(chunk);
    }
  };

  for (const repoFullName of input.allowedRepos) {
    logger.info({ event: 'github_prose_repo_start', repo: repoFullName });
    let repo;
    try {
      repo = await input.client.getRepo(repoFullName);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        throw holoError({
          code: ErrorCode.HOLO_GITHUB_TOKEN_INVALID,
          problem: 'GitHub returned 401 — token is invalid or expired',
          fix: 'Re-authorize the GitHub connector.',
        });
      }
      logger.warn({ code: 'HOLO_GITHUB_REPO_NOT_FOUND', repoFullName });
      continue;
    }
    // GitHub returns 404 (which the api-client maps to null) for repos the
    // token can't see — including private repos in orgs whose SAML SSO the
    // OAuth app hasn't been authorized for. Without this guard the runner
    // walks an "empty" repo and reports `0 artifacts · ok`, hiding the real
    // permissions problem.
    if (!repo) {
      throw holoError({
        code: ErrorCode.HOLO_GITHUB_REPO_NOT_FOUND,
        problem: `GitHub returned 404 for ${repoFullName} — repo is not visible to this token`,
        fix:
          'Verify the repo exists and the OAuth token has access. For private repos in an org with SAML SSO, ' +
          'authorize the holo OAuth app for that org under Settings → Applications → the holo entry → Configure SSO.',
      });
    }

    // ── PRs ──────────────────────────────────────────────────────────────────
    const cursorTs = prUpdatedSince[repoFullName];
    let newestPrTs = cursorTs ?? '';
    let page = 1;
    let stop = false;

    while (!stop && page <= MAX_PAGES) {
      const { items, hasMore } = await input.client.listPullRequests(repoFullName, {
        state: 'all',
        page,
        perPage: 100,
      });

      for (const pr of items) {
        if (cursorTs && pr.updated_at <= cursorTs) {
          stop = true;
          break;
        }
        if (pr.updated_at > newestPrTs) newestPrTs = pr.updated_at;

        const [files, reviews, reviewComments] = await Promise.all([
          input.client.getPrFiles(repoFullName, pr.number),
          input.client.getPrReviews(repoFullName, pr.number),
          input.client.getPrReviewComments(repoFullName, pr.number),
        ]);

        let linkedIssue: { number: number; title: string; body: string } | undefined;
        const linkedNum = parseLinkedIssueNumber(pr.body);
        if (linkedNum !== null) {
          const issue = await input.client.getIssue(repoFullName, linkedNum);
          if (issue && !issue.pull_request) {
            linkedIssue = {
              number: issue.number,
              title: issue.title,
              body: issue.body ?? '',
            };
          }
        }

        const prChunkInput = {
          prNumber: pr.number,
          repoFullName,
          title: pr.title,
          body: pr.body ?? '',
          linkedIssue,
          files: files.map((f) => ({ path: f.filename, patch: f.patch ?? '' })),
          reviews: groupReviewCommentsByReview(reviews, reviewComments),
        };

        const chunks = await githubPrChunker.chunk(
          prChunkInput,
          { sourceArtifactId: `github-pr:${repoFullName}#${pr.number}`, ...ctx },
        );
        for (const c of chunks) {
          const hash = chunkHash('github-pr', c.content);
          push({
            kind: 'github-pr',
            content: c.content,
            metadata: c.metadata,
            aclSubjects: c.aclSubjects,
            contentHash: hash,
            sourceArtifactId: `github-pr:${repoFullName}#${pr.number}`,
            provider: 'github',
            sourceId: input.sourceId,
            organizationId: input.organizationId,
          });
        }
      }

      // Flush after every page so progress is observable in the embed queue
      // and a mid-walk failure preserves the work done so far.
      await flushBatch();
      if (!hasMore) break;
      page++;
    }

    if (newestPrTs) prUpdatedSince[repoFullName] = newestPrTs;
    await flushBatch();

    // ── Issues ───────────────────────────────────────────────────────────────
    const issueCursor = issueUpdatedSince[repoFullName];
    let newestIssueTs = issueCursor ?? '';
    page = 1;

    while (page <= MAX_PAGES) {
      const { items, hasMore } = await input.client.listIssues(repoFullName, {
        page,
        perPage: 100,
        since: issueCursor,
      });

      for (const issue of items) {
        if (issue.pull_request) continue; // PRs appear in issues endpoint too
        if (issue.updated_at > newestIssueTs) newestIssueTs = issue.updated_at;

        const comments = await input.client.getIssueComments(repoFullName, issue.number);
        const issueChunkInput = {
          issueNumber: issue.number,
          repoFullName,
          title: issue.title,
          body: issue.body ?? '',
          comments: comments.map((c) => ({ author: c.user.login, body: c.body })),
        };

        const chunks = await githubIssueChunker.chunk(issueChunkInput, {
          sourceArtifactId: `github-issue:${repoFullName}#${issue.number}`,
          ...ctx,
        });
        for (const c of chunks) {
          const hash = chunkHash('github-issue', c.content);
          push({
            kind: 'github-issue',
            content: c.content,
            metadata: c.metadata,
            aclSubjects: c.aclSubjects,
            contentHash: hash,
            sourceArtifactId: `github-issue:${repoFullName}#${issue.number}`,
            provider: 'github',
            sourceId: input.sourceId,
            organizationId: input.organizationId,
          });
        }
      }

      await flushBatch();
      if (!hasMore) break;
      page++;
    }

    if (newestIssueTs) issueUpdatedSince[repoFullName] = newestIssueTs;
    await flushBatch();

    // ── Docs (README + docs/**/*.md) ─────────────────────────────────────────
    let treeSha: string;
    try {
      const ref = await input.client.getRef(repoFullName, `heads/${repo.default_branch}`);
      treeSha = ref.sha;
    } catch {
      logger.warn({ code: 'HOLO_GITHUB_REF_FAILED', repoFullName });
      continue;
    }

    const tree = await input.client.getTree(repoFullName, treeSha);
    const docFiles = tree.filter(
      (f) =>
        f.type === 'blob' &&
        (f.path === 'README.md' ||
          f.path.toLowerCase().startsWith('docs/') && f.path.endsWith('.md')),
    );

    for (const file of docFiles) {
      const storedSha = docShas[`${repoFullName}:${file.path}`];
      if (storedSha === file.sha) continue; // unchanged

      const content = await input.client.getFileContent(repoFullName, file.path, treeSha);
      if (!content) continue;

      const docChunkInput = { repoFullName, filePath: file.path, content };
      const chunks = await githubDocChunker.chunk(docChunkInput, {
        sourceArtifactId: `github-doc:${repoFullName}:${file.path}`,
        ...ctx,
      });
      for (const c of chunks) {
        const hash = chunkHash('github-doc', c.content);
        push({
          kind: 'github-doc',
          content: c.content,
          metadata: c.metadata,
          aclSubjects: c.aclSubjects,
          contentHash: hash,
          sourceArtifactId: `github-doc:${repoFullName}:${file.path}`,
          provider: 'github',
          sourceId: input.sourceId,
          organizationId: input.organizationId,
        });
      }
      docShas[`${repoFullName}:${file.path}`] = file.sha;
    }

    await flushBatch();
    logger.info({
      event: 'github_prose_repo_done',
      repo: repoFullName,
      runningArtifactCount: totalArtifacts,
    });
  }

  logger.info({ event: 'github_prose_done', artifactCount: totalArtifacts });
  return {
    artifactCount: totalArtifacts,
    updatedMetadata: {
      ...input.cursorMetadata,
      pr_updated_since: prUpdatedSince,
      issue_updated_since: issueUpdatedSince,
      doc_shas: docShas,
    },
  };
}
