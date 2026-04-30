import { describe, it, expect, vi } from 'vitest';
import { githubCodeChunker } from '../src/github-code.js';
import { createRegistry } from '../src/tree-sitter/registry.js';
import type { ChunkContext } from '../src/contract.js';

const baseCtx = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

describe('githubCodeChunker', () => {
  it('TypeScript with three top-level functions → 3 chunks with symbol_name', async () => {
    const registry = createRegistry();
    const ctx: ChunkContext = { ...baseCtx, treeSitter: registry };
    const content = `function foo() {
  return 1;
}

function bar() {
  return 2;
}

function baz() {
  return 3;
}`;
    const chunks = await githubCodeChunker.chunk(
      {
        repoFullName: 'acme/api',
        commitSha: 'abc123',
        filePath: 'src/utils.ts',
        language: 'typescript',
        content,
      },
      ctx,
    );
    expect(chunks).toHaveLength(3);
    const names = chunks.map((c) => c.metadata.symbol_name);
    expect(names).toEqual(['foo', 'bar', 'baz']);
    for (const c of chunks) {
      expect(c.metadata.language).toBe('typescript');
    }
  });

  it('unknown language (cobol) → falls back to recursiveSplit + warning', async () => {
    const registry = createRegistry();
    const ctx: ChunkContext = { ...baseCtx, treeSitter: registry };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const content = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. HELLO.\n';
    const chunks = await githubCodeChunker.chunk(
      {
        repoFullName: 'acme/api',
        commitSha: 'abc123',
        filePath: 'main.cob',
        language: 'cobol',
        content,
      },
      ctx,
    );
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.metadata.language).toBe('cobol');
      expect(c.metadata.symbol_name).toBeUndefined();
    }
    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((s) => s.includes('HOLO_CHUNKER_FALLBACK'))).toBe(true);
    warnSpy.mockRestore();
  });

  it('missing ctx.treeSitter → throws', async () => {
    await expect(
      githubCodeChunker.chunk(
        {
          repoFullName: 'acme/api',
          commitSha: 'abc123',
          filePath: 'main.ts',
          language: 'typescript',
          content: 'function f(){}',
        },
        baseCtx,
      ),
    ).rejects.toThrow(/treeSitter/);
  });

  it('embeddingModel is voyage-code-3', () => {
    expect(githubCodeChunker.embeddingModel).toBe('voyage-code-3');
  });

  it('all chunks share parentExternalId keyed by commitSha', async () => {
    const registry = createRegistry();
    const ctx: ChunkContext = { ...baseCtx, treeSitter: registry };
    const content = `function f() {}\nfunction g() {}\n`;
    const chunks = await githubCodeChunker.chunk(
      {
        repoFullName: 'acme/api',
        commitSha: 'sha-xyz',
        filePath: 'src/x.ts',
        language: 'typescript',
        content,
      },
      ctx,
    );
    const ids = new Set(chunks.map((c) => c.parentExternalId));
    expect(ids.size).toBe(1);
    expect(chunks[0]!.parentExternalId).toBe('code:acme/api:sha-xyz:src/x.ts');
  });
});
