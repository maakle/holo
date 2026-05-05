// packages/db/test/discovery-schema.test.ts
import { describe, it, expect } from 'vitest';
import { schema } from '../src';

describe('discovery schema', () => {
  it('exposes procedureEpisodes with required columns', () => {
    const t = schema.procedureEpisodes;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of [
      'id', 'organizationId', 'sourceArtifactIds', 'centroidEmbedding',
      'entityKey', 'firstSeenAt', 'lastSeenAt', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('exposes procedureProposals with required columns', () => {
    const t = schema.procedureProposals;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of [
      'id', 'organizationId', 'episodeId', 'proposedSlug', 'proposedName',
      'summary', 'status', 'rejectionReasonHash', 'createdAt',
    ]) {
      expect(cols).toContain(c);
    }
  });

  it('exposes procedureProposalDecisions with required columns', () => {
    const t = schema.procedureProposalDecisions;
    expect(t).toBeDefined();
    const cols = Object.keys(t);
    for (const c of ['id', 'organizationId', 'proposalId', 'decision', 'finalSlug', 'decidedBy', 'decidedAt']) {
      expect(cols).toContain(c);
    }
  });
});
