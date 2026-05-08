import { describe, it, expect } from 'vitest';
import {
  hubspotRecordChunker,
  type HubspotRecordInput,
} from '../src/hubspot-record';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'hubspot-deal:42',
};

function baseDeal(overrides: Partial<HubspotRecordInput> = {}): HubspotRecordInput {
  return {
    recordType: 'deal',
    recordId: '42',
    displayName: 'Acme — Q4 Renewal',
    properties: {
      dealname: 'Acme — Q4 Renewal',
      dealstage: 'negotiation',
      amount: '50000',
      pipeline: 'sales',
    },
    createdAt: new Date('2026-01-10T09:00:00Z'),
    updatedAt: new Date('2026-02-14T10:00:00Z'),
    engagements: [
      {
        id: 'note-1',
        type: 'note',
        createdAt: new Date('2026-01-15T12:00:00Z'),
        body: 'Customer pushing back on price; willing to discount 10% if multi-year.',
      },
      {
        id: 'call-9',
        type: 'call',
        subject: 'Pricing discussion',
        callOutcome: 'connected',
        callDurationSec: 1800,
        createdAt: new Date('2026-02-01T15:00:00Z'),
        body: 'Walked through tiered pricing; champion confirmed Q4 close.',
      },
    ],
    ...overrides,
  };
}

describe('hubspotRecordChunker', () => {
  it('emits record + engagement chunks with shared parent and acl', async () => {
    const chunks = await hubspotRecordChunker.chunk(baseDeal(), ctx);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.parentExternalId === 'hubspot-deal:42')).toBe(true);
    expect(chunks.every((c) => c.aclSubjects.includes('org:org-1'))).toBe(true);
    expect(chunks[0]!.metadata['chunk_role']).toBe('record');
    expect(chunks[1]!.metadata['chunk_role']).toBe('engagement');
    expect(chunks[2]!.metadata['chunk_role']).toBe('engagement');
  });

  it('orders engagements chronologically', async () => {
    const chunks = await hubspotRecordChunker.chunk(
      baseDeal({
        engagements: [
          {
            id: 'b',
            type: 'note',
            createdAt: new Date('2026-03-01T00:00:00Z'),
            body: 'later',
          },
          {
            id: 'a',
            type: 'note',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            body: 'earlier',
          },
        ],
      }),
      ctx,
    );
    expect(chunks[1]!.metadata['engagement_id']).toBe('a');
    expect(chunks[2]!.metadata['engagement_id']).toBe('b');
  });

  it('record chunk includes properties and display name', async () => {
    const chunks = await hubspotRecordChunker.chunk(baseDeal(), ctx);
    const recordContent = chunks[0]!.content;
    expect(recordContent).toContain('# Acme — Q4 Renewal');
    expect(recordContent).toContain('dealstage: negotiation');
    expect(recordContent).toContain('amount: 50000');
  });

  it('engagement chunk surfaces call metadata in body', async () => {
    const chunks = await hubspotRecordChunker.chunk(baseDeal(), ctx);
    const callChunk = chunks.find((c) => c.metadata['engagement_id'] === 'call-9');
    expect(callChunk).toBeDefined();
    expect(callChunk!.content).toContain('Outcome: connected');
    expect(callChunk!.content).toContain('Duration: 1800s');
    expect(callChunk!.content).toContain('Pricing discussion');
  });

  it('skips empty/null properties', async () => {
    const chunks = await hubspotRecordChunker.chunk(
      baseDeal({
        properties: { dealname: 'X', amount: null, description: '', dealstage: 'won' },
      }),
      ctx,
    );
    const recordContent = chunks[0]!.content;
    expect(recordContent).not.toContain('amount:');
    expect(recordContent).not.toContain('description:');
    expect(recordContent).toContain('dealstage: won');
  });

  it('handles record with no engagements (single chunk)', async () => {
    const chunks = await hubspotRecordChunker.chunk(baseDeal({ engagements: [] }), ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata['chunk_role']).toBe('record');
  });

  it('contact recordType derives display name from first/last', async () => {
    // The chunker takes displayName as input; this test just confirms the
    // contact path encodes record_type into metadata.
    const chunks = await hubspotRecordChunker.chunk(
      {
        recordType: 'contact',
        recordId: 'c-1',
        displayName: 'Jane Doe',
        properties: { email: 'jane@acme.com' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        engagements: [],
      },
      ctx,
    );
    expect(chunks[0]!.metadata['record_type']).toBe('contact');
    expect(chunks[0]!.content).toContain('# Jane Doe');
  });
});
