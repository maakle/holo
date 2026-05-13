/**
 * Citation projection + wire-format conversion. Pure unit tests — no DB,
 * no LLM. Covers the user-visible parts of the "cited answers" feature:
 *   - label + URL building per provider (GitHub, HubSpot, Pylon, Salesforce,
 *     Grain, Notion, Slack, unknown)
 *   - snippet truncation
 *   - camelCase ↔ snake_case wire conversion for Citation and SearchCoverage
 */
import { describe, expect, it } from 'vitest';
import type { SearchCoverage, SearchResult } from '@holo/retrieval-core';
import {
  buildCitationLabel,
  buildCitationSnippet,
  buildCitationUrl,
  citationToWire,
  toCitation,
} from '../src/citations';
import { coverageToWire } from '../src/coverage-wire';

function makeResult(overrides: Partial<SearchResult> & {
  provider: string;
  artifactKind: string;
  metadata?: Record<string, unknown>;
}): SearchResult {
  return {
    chunkId: 'c-1',
    content: 'some chunk content',
    score: 0.5,
    source: {
      provider: overrides.provider,
      artifactKind: overrides.artifactKind,
      metadata: overrides.metadata ?? {},
    },
    ...(overrides.snippetUrl !== undefined ? { snippetUrl: overrides.snippetUrl } : {}),
  };
}

describe('buildCitationUrl', () => {
  it('prefers an already-resolved snippetUrl when present', () => {
    const r = makeResult({ provider: 'github', artifactKind: 'pr', snippetUrl: 'https://override/' });
    expect(buildCitationUrl(r)).toBe('https://override/');
  });

  it('builds GitHub PR URLs from repo + pr_number', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'pr',
      metadata: { repo_full_name: 'acme/repo', pr_number: 42 },
    });
    expect(buildCitationUrl(r)).toBe('https://github.com/acme/repo/pull/42');
  });

  it('builds GitHub doc URLs at HEAD when no commit_sha is indexed', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'doc',
      metadata: { repo_full_name: 'acme/repo', file_path: 'README.md' },
    });
    expect(buildCitationUrl(r)).toBe('https://github.com/acme/repo/blob/HEAD/README.md');
  });

  it('builds GitHub code URLs with commit_sha + line anchors', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'code',
      metadata: {
        repo_full_name: 'acme/repo',
        file_path: 'src/foo.ts',
        commit_sha: 'abc123',
        start_line: 10,
        end_line: 20,
      },
    });
    expect(buildCitationUrl(r)).toBe('https://github.com/acme/repo/blob/abc123/src/foo.ts#L10-L20');
  });

  it('builds Notion URLs (strips dashes from the page id)', () => {
    const r = makeResult({
      provider: 'notion',
      artifactKind: 'page',
      metadata: { notion_page_id: '11112222-3333-4444-5555-666677778888' },
    });
    expect(buildCitationUrl(r)).toBe('https://www.notion.so/11112222333344445555666677778888');
  });

  it('returns undefined for providers we have no URL recipe for', () => {
    const r = makeResult({
      provider: 'salesforce',
      artifactKind: 'salesforce-account',
      metadata: { display_name: 'Skello' },
    });
    expect(buildCitationUrl(r)).toBeUndefined();
  });
});

describe('buildCitationLabel', () => {
  it('renders GitHub PRs with number + repo + title', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'pr',
      metadata: { repo_full_name: 'acme/repo', pr_number: 7, title: 'Fix the bug' },
    });
    expect(buildCitationLabel(r)).toBe('PR #7 · acme/repo — Fix the bug');
  });

  it('renders HubSpot records with display_name + kind', () => {
    const r = makeResult({
      provider: 'hubspot',
      artifactKind: 'hubspot-company',
      metadata: { display_name: 'Skello' },
    });
    expect(buildCitationLabel(r)).toBe('HubSpot hubspot-company — Skello');
  });

  it('falls back to "<kind> · <provider>" for unhandled shapes', () => {
    const r = makeResult({ provider: 'stripe', artifactKind: 'invoice' });
    expect(buildCitationLabel(r)).toBe('invoice · stripe');
  });

  it('falls back to provider alone when there is no kind', () => {
    const r = makeResult({ provider: 'webcrawl', artifactKind: '' });
    expect(buildCitationLabel(r)).toBe('webcrawl');
  });
});

describe('buildCitationSnippet', () => {
  it('collapses whitespace and trims', () => {
    const r = makeResult({
      provider: 'slack',
      artifactKind: 'thread',
      // Wrapping in extra whitespace + newlines exercises the collapse.
    });
    r.content = '  hello\n\n  world  ';
    expect(buildCitationSnippet(r)).toBe('hello world');
  });

  it('truncates to ~200 chars with an ellipsis', () => {
    const long = 'x'.repeat(400);
    const r = makeResult({ provider: 'github', artifactKind: 'doc' });
    r.content = long;
    const snippet = buildCitationSnippet(r);
    expect(snippet.length).toBe(200);
    expect(snippet.endsWith('…')).toBe(true);
  });
});

describe('toCitation', () => {
  it('assigns the 1-based index from the caller', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'pr',
      metadata: { repo_full_name: 'acme/repo', pr_number: 42 },
    });
    const c = toCitation(r, 3);
    expect(c.index).toBe(3);
    expect(c.chunkId).toBe('c-1');
    expect(c.url).toBe('https://github.com/acme/repo/pull/42');
    expect(c.label).toContain('PR #42');
  });

  it('omits url when no recipe matches (rather than emitting an empty string)', () => {
    const r = makeResult({ provider: 'salesforce', artifactKind: 'salesforce-account' });
    const c = toCitation(r, 1);
    expect(c.url).toBeUndefined();
    expect('url' in c).toBe(false);
  });
});

describe('citationToWire', () => {
  it('converts camelCase Citation to snake_case WireCitation', () => {
    const r = makeResult({
      provider: 'github',
      artifactKind: 'pr',
      metadata: { repo_full_name: 'acme/repo', pr_number: 1 },
    });
    const c = toCitation(r, 1);
    const wire = citationToWire(c);
    expect(wire).toEqual({
      index: 1,
      chunk_id: 'c-1',
      provider: 'github',
      artifact_kind: 'pr',
      label: c.label,
      url: 'https://github.com/acme/repo/pull/1',
      snippet: c.snippet,
    });
  });

  it('omits url field when the camelCase source has no url', () => {
    const r = makeResult({ provider: 'salesforce', artifactKind: 'account' });
    const wire = citationToWire(toCitation(r, 1));
    expect('url' in wire).toBe(false);
  });
});

describe('coverageToWire', () => {
  it('converts every nested field including pass branchCounts', () => {
    const cov: SearchCoverage = {
      query: 'invoice from skello',
      filters: {
        provider: 'hubspot',
        accountIds: ['acc-1'],
        userSubjectsCount: 3,
        topK: 10,
      },
      passes: [
        {
          role: 'primary',
          embeddingModel: 'openai-3-small',
          branchCounts: { vectorReturned: 100, bm25Returned: 5, fusedReturned: 10 },
          timingsMs: 142,
        },
      ],
      fallbackUsed: false,
      totalReturned: 10,
      totalTimingsMs: 150,
    };
    const wire = coverageToWire(cov);
    expect(wire.query).toBe('invoice from skello');
    expect(wire.filters).toEqual({
      provider: 'hubspot',
      account_ids: ['acc-1'],
      user_subjects_count: 3,
      top_k: 10,
    });
    expect(wire.passes[0]).toEqual({
      role: 'primary',
      embedding_model: 'openai-3-small',
      branch_counts: { vector_returned: 100, bm25_returned: 5, fused_returned: 10 },
      timings_ms: 142,
    });
    expect(wire.fallback_used).toBe(false);
    expect(wire.total_returned).toBe(10);
    expect(wire.total_timings_ms).toBe(150);
  });

  it('preserves null filters', () => {
    const cov: SearchCoverage = {
      query: 'q',
      filters: { provider: null, accountIds: null, userSubjectsCount: 0, topK: 5 },
      passes: [],
      fallbackUsed: false,
      totalReturned: 0,
      totalTimingsMs: 0,
    };
    const wire = coverageToWire(cov);
    expect(wire.filters.provider).toBeNull();
    expect(wire.filters.account_ids).toBeNull();
  });
});
