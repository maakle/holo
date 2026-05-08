import { describe, it, expect } from 'vitest';
import { pylonTicketChunker, type PylonTicketInput } from '../src/pylon-ticket';
import type { ChunkContext } from '../src/contract';

const ctx: ChunkContext = {
  organizationId: 'org-1',
  sourceId: 'src-1',
  sourceArtifactId: 'sa-1',
};

function baseTicket(overrides: Partial<PylonTicketInput> = {}): PylonTicketInput {
  return {
    ticketId: 'tkt-001',
    title: 'Login not working',
    status: 'open',
    priority: 'high',
    createdAt: new Date('2024-09-01T09:00:00Z'),
    updatedAt: new Date('2024-09-01T10:30:00Z'),
    customerName: 'Jane Doe',
    customerEmail: 'jane@acme.com',
    companyName: 'Acme Corp',
    assigneeName: 'Support Agent',
    tags: ['auth', 'bug'],
    messages: [
      {
        id: 'm1',
        author: 'Jane Doe',
        authorType: 'customer',
        createdAt: new Date('2024-09-01T09:00:00Z'),
        body: 'I cannot log in to the platform.',
      },
      {
        id: 'm2',
        author: 'Support Agent',
        authorType: 'agent',
        createdAt: new Date('2024-09-01T09:15:00Z'),
        body: 'Thanks for reaching out. Can you share the error message?',
      },
    ],
    ...overrides,
  };
}

describe('pylonTicketChunker', () => {
  it('produces exactly one chunk', async () => {
    const chunks = await pylonTicketChunker.chunk(baseTicket(), ctx);
    expect(chunks).toHaveLength(1);
  });

  it('chunk content contains title, status, company, customer, and message bodies', async () => {
    const chunks = await pylonTicketChunker.chunk(baseTicket(), ctx);
    const content = chunks[0]!.content;
    expect(content).toContain('Login not working');
    expect(content).toContain('open');
    expect(content).toContain('Acme Corp');
    expect(content).toContain('Jane Doe');
    expect(content).toContain('I cannot log in to the platform.');
    expect(content).toContain('Can you share the error message?');
  });

  it('messages are sorted chronologically', async () => {
    const ticket = baseTicket({
      messages: [
        {
          id: 'm2',
          author: 'Agent',
          authorType: 'agent',
          createdAt: new Date('2024-09-01T09:15:00Z'),
          body: 'Second message.',
        },
        {
          id: 'm1',
          author: 'Customer',
          authorType: 'customer',
          createdAt: new Date('2024-09-01T09:00:00Z'),
          body: 'First message.',
        },
      ],
    });
    const chunks = await pylonTicketChunker.chunk(ticket, ctx);
    const content = chunks[0]!.content;
    expect(content.indexOf('First message.')).toBeLessThan(content.indexOf('Second message.'));
  });

  it('aclSubjects contains org subject', async () => {
    const chunks = await pylonTicketChunker.chunk(baseTicket(), ctx);
    expect(chunks[0]!.aclSubjects).toContain('org:org-1');
  });

  it('parentExternalId is pylon-ticket:<ticketId>', async () => {
    const chunks = await pylonTicketChunker.chunk(baseTicket(), ctx);
    expect(chunks[0]!.parentExternalId).toBe('pylon-ticket:tkt-001');
  });

  it('metadata contains ticket_id, status, company_name, tags', async () => {
    const chunks = await pylonTicketChunker.chunk(baseTicket(), ctx);
    const meta = chunks[0]!.metadata;
    expect(meta['ticket_id']).toBe('tkt-001');
    expect(meta['status']).toBe('open');
    expect(meta['company_name']).toBe('Acme Corp');
    expect(meta['tags']).toEqual(['auth', 'bug']);
  });

  it('no messages → chunk still contains ticket header', async () => {
    const ticket = baseTicket({ messages: [] });
    const chunks = await pylonTicketChunker.chunk(ticket, ctx);
    expect(chunks[0]!.content).toContain('Login not working');
  });
});
