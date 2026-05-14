import { describe, it, expect } from 'vitest';
import { clusterInvocations } from '../auto-extract';

describe('clusterInvocations', () => {
  it('groups by tool name and counts', () => {
    const invocations = [
      { toolName: 'search', inputJson: { query: 'incident' } },
      { toolName: 'search', inputJson: { query: 'postmortem' } },
      { toolName: 'bash', inputJson: { script: 'cat /github/acme/api/pulls/42.md' } },
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
