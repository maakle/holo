import { describe, it, expect } from 'vitest';
import { extractBashSources, resolveBashSourceUrls } from '../src/slack-bot/agent';
import type { DB } from '@holo/db';

describe('extractBashSources', () => {
  it('extracts a single path from a cat invocation', () => {
    const sources = extractBashSources(
      'cat /sample/docs/doc-order-66-contingency.md',
      'GAR Contingency Order 66 (CLASSIFIED)…',
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      provider: 'sample',
      kind: 'file',
      title: 'doc-order-66-contingency.md',
      url: '/files/sample/docs/doc-order-66-contingency.md',
    });
  });

  it('extracts multiple paths from a grep -rl stdout', () => {
    const sources = extractBashSources(
      'grep -rl Rebel /sample',
      '/sample/docs/doc-rebellion-charter.md\n'
        + '/sample/docs/doc-skywalker-saga-overview.md\n'
        + '/sample/messages/msg-holdo-transfer.md\n',
    );
    expect(sources).toHaveLength(3);
    expect(sources.map((s) => s.url)).toEqual([
      '/files/sample/docs/doc-rebellion-charter.md',
      '/files/sample/docs/doc-skywalker-saga-overview.md',
      '/files/sample/messages/msg-holdo-transfer.md',
    ]);
  });

  it('deduplicates the same path across script and stdout', () => {
    const sources = extractBashSources(
      'cat /github/acme/api/pulls/42.md',
      '/github/acme/api/pulls/42.md\n# Title\nbody...\n',
    );
    expect(sources).toHaveLength(1);
  });

  it('caps at 20 sources per call to keep the citation card readable', () => {
    const stdout = Array.from({ length: 50 }, (_, i) =>
      `/notion/page-${i}.md`).join('\n');
    const sources = extractBashSources('grep -rl x /notion', stdout);
    expect(sources).toHaveLength(20);
  });

  it('ignores paths that do not start with a slug-shaped root', () => {
    const sources = extractBashSources(
      'cat ./relative.md /tmp/absolute.md "/Has Spaces/x.md"',
      '',
    );
    // `./relative.md` is relative, `/tmp/...` is system not virtual-FS,
    // `/Has Spaces/x.md` starts with uppercase. None should match.
    expect(sources).toHaveLength(0);
  });

  it('url-encodes path segments to handle special characters', () => {
    const sources = extractBashSources(
      'cat /slack/#engineering/2026-05-14/thread-1.md',
      '',
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]!.url).toBe(
      '/files/slack/%23engineering/2026-05-14/thread-1.md',
    );
  });

  it('returns the empty list when no paths are present', () => {
    expect(extractBashSources('echo hello', 'hello\n')).toEqual([]);
  });
});

/**
 * Stub `DB` exposing just the chainable shape used by
 * `resolveBashSourceUrls`: db.select(...).from(...).where(...) awaits to
 * the rows directly.
 */
function stubDb(rows: { path: string; sourceUrl: string | null }[]): DB {
  const chain: { from: () => typeof chain; where: () => Promise<typeof rows> } = {
    from: () => chain,
    where: () => Promise.resolve(rows),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { select: () => chain } as unknown as DB;
}

function failingDb(): DB {
  const chain = {
    from: () => chain,
    where: () => {
      throw new Error('db down');
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { select: () => chain } as unknown as DB;
}

describe('resolveBashSourceUrls', () => {
  it('promotes /files URLs to real source URLs when source_url is stored', async () => {
    const db = stubDb([
      {
        path: '/github/acme/api/pulls/42.md',
        sourceUrl: 'https://github.com/acme/api/pull/42',
      },
      { path: '/stripe/charges/ch_x.md', sourceUrl: 'https://dashboard.stripe.com/payments/ch_x' },
    ]);
    const extracted = extractBashSources(
      'cat /github/acme/api/pulls/42.md /stripe/charges/ch_x.md',
      '',
    ).map((s, i) => ({
      ...s,
      path: i === 0 ? '/github/acme/api/pulls/42.md' : '/stripe/charges/ch_x.md',
    }));

    const resolved = await resolveBashSourceUrls(db, 'org-1', extracted);

    expect(resolved.map((s) => s.url)).toEqual([
      'https://github.com/acme/api/pull/42',
      'https://dashboard.stripe.com/payments/ch_x',
    ]);
    // `path` is internal — should never leak out.
    for (const s of resolved) expect(s).not.toHaveProperty('path');
  });

  it('keeps the dashboard URL when source_url is null for that artifact', async () => {
    const db = stubDb([
      { path: '/sample/docs/doc-order-66-contingency.md', sourceUrl: null },
    ]);
    const extracted = extractBashSources(
      'cat /sample/docs/doc-order-66-contingency.md',
      '',
    ).map((s) => ({ ...s, path: '/sample/docs/doc-order-66-contingency.md' }));

    const resolved = await resolveBashSourceUrls(db, 'org-1', extracted);

    expect(resolved[0]!.url).toBe(
      '/files/sample/docs/doc-order-66-contingency.md',
    );
  });

  it('returns inputs unchanged when the DB lookup throws (best-effort enrichment)', async () => {
    const extracted = extractBashSources(
      'cat /github/acme/api/pulls/42.md',
      '',
    ).map((s) => ({ ...s, path: '/github/acme/api/pulls/42.md' }));

    const resolved = await resolveBashSourceUrls(failingDb(), 'org-1', extracted);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.url).toBe('/files/github/acme/api/pulls/42.md');
  });

  it('returns the empty list when given no sources (no DB round-trip)', async () => {
    let queried = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = {
      select: () => {
        queried = true;
        throw new Error('should not query');
      },
    } as unknown as DB;
    const result = await resolveBashSourceUrls(db, 'org-1', []);
    expect(result).toEqual([]);
    expect(queried).toBe(false);
  });
});
