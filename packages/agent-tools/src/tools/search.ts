import { z } from 'zod';
import type { DB } from '@holo/db';
import { search, type SearchResult } from '@holo/retrieval-core';
import { maybeReportTthw, readTthwEnv } from '../tthw';

export const searchInputSchema = z.object({
  q: z.string().min(1),
  top_k: z.number().int().min(1).max(50).optional().default(10),
  provider: z.enum(['github', 'slack', 'notion', 'grain', 'pylon']).optional(),
});

export interface SearchToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  /**
   * Optional override for `process.env`. Tests inject a controlled object;
   * the gateway leaves this undefined so the real env is read.
   */
  envOverride?: Record<string, string | undefined>;
}

function deriveSnippetUrl(result: SearchResult): string | undefined {
  if (result.snippetUrl) return result.snippetUrl;
  const m = result.source.metadata;
  const provider = result.source.provider;

  if (provider === 'github') {
    const kind = result.source.artifactKind;
    const repo = m['repo_full_name'] ?? m['repoFullName'];
    if (typeof repo !== 'string') return undefined;
    if (kind === 'pr' && typeof m['pr_number'] === 'number') {
      return `https://github.com/${repo}/pull/${m['pr_number']}`;
    }
    if (kind === 'doc' && typeof m['file_path'] === 'string') {
      return `https://github.com/${repo}/blob/HEAD/${m['file_path']}`;
    }
    if (kind === 'code' && typeof m['file_path'] === 'string') {
      // Prefer commit_sha when indexed; otherwise fall back to HEAD so the
      // link still resolves (line anchors work the same).
      const ref = typeof m['commit_sha'] === 'string' ? m['commit_sha'] : 'HEAD';
      const start = m['start_line'] !== undefined ? `#L${m['start_line']}` : '';
      const end = m['end_line'] !== undefined ? `-L${m['end_line']}` : '';
      return `https://github.com/${repo}/blob/${ref}/${m['file_path']}${start}${end}`;
    }
  }
  if (provider === 'notion' && typeof m['notion_page_id'] === 'string') {
    return `https://www.notion.so/${(m['notion_page_id'] as string).replace(/-/g, '')}`;
  }
  if (provider === 'grain' && typeof m['recording_id'] === 'string') {
    return `https://grain.com/share/recording/${m['recording_id']}`;
  }
  // TODO(pylon): verify against real Pylon data once a customer has Pylon
  // connected. Pylon's API returns both `id` (UUID, stored as ticket_id) and
  // `number` (human-readable, stored as issue_number); we use the latter
  // because the app URL is `?issueNumber=<n>`. If it turns out Pylon's `id`
  // actually equals the issue number in some environments, simplify to use
  // ticket_id directly.
  if (provider === 'pylon' && typeof m['issue_number'] === 'number') {
    return `https://app.usepylon.com/issues?issueNumber=${m['issue_number']}`;
  }
  return undefined;
}

export async function runSearchTool(
  ctx: SearchToolContext,
  rawInput: unknown,
): Promise<{ results: Array<{
  chunk_id: string;
  content: string;
  score: number;
  source: { provider: string; artifact_kind: string; metadata: Record<string, unknown> };
  snippet_url?: string;
}> }> {
  const input = searchInputSchema.parse(rawInput);
  const results = await search({
    db: ctx.db,
    organizationId: ctx.organizationId,
    q: input.q,
    topK: input.top_k,
    provider: input.provider,
    userSubjects: ctx.userSubjects,
  });

  // CP3 follow-up: fire the TTHW first-search reporter. No-op when telemetry
  // env vars are absent or opt-in is false. Awaited (cheap when no-op) so
  // tests can observe the side effect, but the underlying POST is fire-and-
  // forget inside maybeReportTthw.
  await maybeReportTthw({
    db: ctx.db,
    env: readTthwEnv(ctx.envOverride ?? process.env),
  });

  return {
    results: results.map((r) => {
      const snippet = deriveSnippetUrl(r);
      return {
        chunk_id: r.chunkId,
        content: r.content,
        score: r.score,
        source: {
          provider: r.source.provider,
          artifact_kind: r.source.artifactKind,
          metadata: r.source.metadata,
        },
        ...(snippet !== undefined ? { snippet_url: snippet } : {}),
      };
    }),
  };
}
