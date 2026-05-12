import { describe, it, expect } from 'vitest';
import {
  salesforceRecordChunker,
  type SalesforceRecordInput,
} from '../src/salesforce-record';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'salesforce-opportunity:42',
};

function baseOpportunity(
  overrides: Partial<SalesforceRecordInput> = {},
): SalesforceRecordInput {
  return {
    recordType: 'opportunity',
    recordId: '42',
    displayName: 'Acme — Q4 Renewal',
    properties: {
      Name: 'Acme — Q4 Renewal',
      StageName: 'Negotiation',
      Amount: 50000,
      Probability: 70,
    },
    createdAt: new Date('2026-01-10T09:00:00Z'),
    updatedAt: new Date('2026-02-14T10:00:00Z'),
    activities: [
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

describe('salesforceRecordChunker', () => {
  it('emits record + activity chunks with shared parent and acl', async () => {
    const chunks = await salesforceRecordChunker.chunk(baseOpportunity(), ctx);
    expect(chunks).toHaveLength(3);
    expect(
      chunks.every((c) => c.parentExternalId === 'salesforce-opportunity:42'),
    ).toBe(true);
    expect(chunks.every((c) => c.aclSubjects.includes('org:org-1'))).toBe(true);
    expect(chunks[0]!.metadata['chunk_role']).toBe('record');
    expect(chunks[1]!.metadata['chunk_role']).toBe('activity');
    expect(chunks[2]!.metadata['chunk_role']).toBe('activity');
  });

  it('orders activities chronologically', async () => {
    const chunks = await salesforceRecordChunker.chunk(
      baseOpportunity({
        activities: [
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
    expect(chunks[1]!.metadata['activity_id']).toBe('a');
    expect(chunks[2]!.metadata['activity_id']).toBe('b');
  });

  it('record chunk includes properties and display name', async () => {
    const chunks = await salesforceRecordChunker.chunk(baseOpportunity(), ctx);
    const recordContent = chunks[0]!.content;
    expect(recordContent).toContain('# Acme — Q4 Renewal');
    expect(recordContent).toContain('StageName: Negotiation');
    expect(recordContent).toContain('Amount: 50000');
  });

  it('activity chunk surfaces call metadata in body', async () => {
    const chunks = await salesforceRecordChunker.chunk(baseOpportunity(), ctx);
    const callChunk = chunks.find((c) => c.metadata['activity_id'] === 'call-9');
    expect(callChunk).toBeDefined();
    expect(callChunk!.content).toContain('Outcome: connected');
    expect(callChunk!.content).toContain('Duration: 1800s');
    expect(callChunk!.content).toContain('Pricing discussion');
  });

  it('skips empty/null properties', async () => {
    const chunks = await salesforceRecordChunker.chunk(
      baseOpportunity({
        properties: {
          Name: 'X',
          Amount: null,
          Description: '',
          StageName: 'Closed Won',
        },
      }),
      ctx,
    );
    const recordContent = chunks[0]!.content;
    expect(recordContent).not.toContain('Amount:');
    expect(recordContent).not.toContain('Description:');
    expect(recordContent).toContain('StageName: Closed Won');
  });

  it('handles record with no activities (single chunk)', async () => {
    const chunks = await salesforceRecordChunker.chunk(
      baseOpportunity({ activities: [] }),
      ctx,
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.metadata['chunk_role']).toBe('record');
  });

  it('contact recordType encodes record_type into metadata', async () => {
    const chunks = await salesforceRecordChunker.chunk(
      {
        recordType: 'contact',
        recordId: 'c-1',
        displayName: 'Jane Doe',
        properties: { Email: 'jane@acme.com' },
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        activities: [],
      },
      ctx,
    );
    expect(chunks[0]!.metadata['record_type']).toBe('contact');
    expect(chunks[0]!.content).toContain('# Jane Doe');
  });
});
