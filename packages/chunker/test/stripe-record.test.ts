import { describe, it, expect } from 'vitest';
import { stripeRecordChunker, type StripeRecordInput } from '../src/stripe-record';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'stripe-customer:cus_123',
};

function customer(overrides: Partial<StripeRecordInput> = {}): StripeRecordInput {
  return {
    recordType: 'customer',
    recordId: 'cus_123',
    displayName: 'Acme Corp',
    lines: ['Email: ops@acme.example', 'Currency: USD'],
    metadata: { customer_id: 'cus_123', customer_email: 'ops@acme.example', currency: 'usd' },
    createdAt: new Date('2026-01-10T09:00:00Z'),
    livemode: true,
    ...overrides,
  };
}

describe('stripeRecordChunker', () => {
  it('emits a single chunk with parent + acl + record_type metadata', async () => {
    const chunks = await stripeRecordChunker.chunk(customer(), ctx);
    expect(chunks).toHaveLength(1);
    const c = chunks[0]!;
    expect(c.parentExternalId).toBe('stripe-customer:cus_123');
    expect(c.aclSubjects).toContain('org:org-1');
    expect(c.metadata['chunk_role']).toBe('record');
    expect(c.metadata['record_type']).toBe('customer');
    expect(c.metadata['record_id']).toBe('cus_123');
    expect(c.metadata['customer_email']).toBe('ops@acme.example');
    expect(c.metadata['livemode']).toBe(true);
  });

  it('puts the display name in the header and includes provided lines', async () => {
    const [chunk] = await stripeRecordChunker.chunk(customer(), ctx);
    expect(chunk!.content).toContain('# Acme Corp');
    expect(chunk!.content).toContain('Email: ops@acme.example');
    expect(chunk!.content).toContain('Currency: USD');
    // Test-mode tag should NOT appear when livemode=true.
    expect(chunk!.content).not.toContain('Mode: test');
  });

  it('marks test-mode records so dashboards can filter them out', async () => {
    const [chunk] = await stripeRecordChunker.chunk(customer({ livemode: false }), ctx);
    expect(chunk!.content).toContain('Mode: test');
    expect(chunk!.metadata['livemode']).toBe(false);
  });

  it('drops undefined metadata fields rather than emitting them as null', async () => {
    const [chunk] = await stripeRecordChunker.chunk(
      customer({ metadata: { customer_id: 'cus_123', currency: undefined } }),
      ctx,
    );
    expect(Object.keys(chunk!.metadata)).not.toContain('currency');
    expect(chunk!.metadata['customer_id']).toBe('cus_123');
  });
});
