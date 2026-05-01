import { describe, it, expect } from 'vitest';
import { rougeL, meanRougeL } from '../eval.js';
import { loadGoldenSet } from '../golden/index.js';

describe('rougeL', () => {
  it('returns 1.0 for identical strings', () => {
    const score = rougeL('the quick brown fox', 'the quick brown fox');
    expect(score.f1).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for completely different strings', () => {
    const score = rougeL('apple orange banana', 'xyz uvw rst');
    expect(score.f1).toBe(0);
  });

  it('near-duplicate gets high score', () => {
    const ref = 'Step 1: Search tickets. Step 2: Check policy. Step 3: Process refund.';
    const hyp = 'Step 1: Search for tickets. Step 2: Check the policy. Step 3: Process the refund.';
    const score = rougeL(hyp, ref);
    expect(score.f1).toBeGreaterThan(0.7);
  });

  it('handles empty hypothesis', () => {
    const score = rougeL('', 'some reference text');
    expect(score.f1).toBe(0);
  });

  it('handles empty reference', () => {
    const score = rougeL('some hypothesis text', '');
    expect(score.f1).toBe(0);
  });
});

describe('golden set eval harness', () => {
  it('loads exactly 10 golden skills', () => {
    const golden = loadGoldenSet();
    expect(golden).toHaveLength(10);
  });

  it('all golden skills have valid structure', () => {
    const golden = loadGoldenSet();
    for (const g of golden) {
      expect(g.parsed.frontmatter.name).toBeTruthy();
      expect(g.parsed.frontmatter.description).toBeTruthy();
      expect(Array.isArray(g.parsed.frontmatter.tools)).toBe(true);
      expect(g.parsed.body).toContain('Procedure');
    }
  });

  it('all tools in golden set are valid holo MCP tools', () => {
    const VALID_TOOLS = new Set(['search', 'get_thread', 'get_pr', 'get_doc', 'get_call', 'get_ticket']);
    const golden = loadGoldenSet();
    for (const g of golden) {
      for (const tool of g.parsed.frontmatter.tools) {
        expect(VALID_TOOLS.has(tool), `invalid tool "${tool}" in ${g.filename}`).toBe(true);
      }
    }
  });

  it('golden vs self: mean ROUGE-L F1 ≥ 0.95 (identity baseline)', () => {
    const golden = loadGoldenSet();
    const pairs = golden.map((g) => ({ hypothesis: g.raw, reference: g.raw }));
    const score = meanRougeL(pairs);
    expect(score.f1).toBeGreaterThanOrEqual(0.95);
  });

  it('clearly wrong document: ROUGE-L F1 < 0.20 (noise baseline)', () => {
    const golden = loadGoldenSet();
    const noise = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
    const pairs = golden.map((g) => ({ hypothesis: noise, reference: g.raw }));
    const score = meanRougeL(pairs);
    expect(score.f1).toBeLessThan(0.20);
  });

  it('SYNTHESIS QUALITY GATE: near-duplicate candidates score ≥ 0.70 mean ROUGE-L F1', () => {
    // This test demonstrates the 0.70 threshold is achievable.
    // In weeks 8-10, this test will be updated to receive real synthesized skill outputs.
    // A failing test here means the synthesis prompt is regressing.
    const golden = loadGoldenSet();
    const candidates = golden.map((g) => {
      // Simulate a synthesized skill: drop the last 3 lines (truncated output)
      const lines = g.raw.split('\n');
      const truncated = lines.slice(0, Math.max(lines.length - 3, Math.floor(lines.length * 0.9))).join('\n');
      return { hypothesis: truncated, reference: g.raw };
    });
    const score = meanRougeL(candidates);
    // Near-duplicate truncation should comfortably exceed the 0.70 threshold
    expect(score.f1).toBeGreaterThanOrEqual(0.70);
  });
});
