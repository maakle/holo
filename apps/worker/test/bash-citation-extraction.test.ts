import { describe, it, expect } from 'vitest';
import { extractBashSources } from '../src/slack-bot/agent';

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
