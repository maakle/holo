import { describe, it, expect } from 'vitest';
import { clusterInvocations } from '../auto-extract.js';

describe('clusterInvocations', () => {
  it('groups by tool name and counts', () => {
    const invocations = [
      { toolName: 'search', inputJson: { query: 'incident' } },
      { toolName: 'search', inputJson: { query: 'postmortem' } },
      { toolName: 'get_pr', inputJson: { owner: 'acme', repo: 'api', number: 42 } },
    ];
    const clusters = clusterInvocations(invocations);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.toolName).toBe('search');
    expect(clusters[0]!.count).toBe(2);
  });

  it('returns empty array for no invocations', () => {
    expect(clusterInvocations([])).toEqual([]);
  });

  it('includes up to 3 examples per cluster', () => {
    const invocations = Array.from({ length: 5 }, (_, i) => ({
      toolName: 'search',
      inputJson: { query: `query-${i}` },
    }));
    const clusters = clusterInvocations(invocations);
    expect(clusters[0]!.examples.length).toBeLessThanOrEqual(3);
  });
});
