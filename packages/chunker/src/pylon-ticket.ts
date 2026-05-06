import type { Chunker, Chunk, ChunkContext } from './contract.js';

export interface PylonMessage {
  id: string;
  author: string;
  authorType: 'customer' | 'agent' | 'bot';
  createdAt: Date;
  body: string;
}

export interface PylonTicketInput {
  ticketId: string;
  /**
   * Human-readable issue number used in app URLs (e.g. ?issueNumber=22963).
   * TODO(pylon): verify against real Pylon data once a customer has Pylon
   * connected — if `ticketId` already equals the issue number in practice,
   * this field is redundant and search.ts URL derivation can simplify.
   */
  issueNumber?: number;
  title: string;
  status: string;
  priority?: string;
  createdAt: Date;
  updatedAt: Date;
  customerName?: string;
  customerEmail?: string;
  companyName?: string;
  assigneeName?: string;
  tags: string[];
  messages: PylonMessage[];
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export const pylonTicketChunker: Chunker<PylonTicketInput> = {
  kind: 'pylon-ticket',
  embeddingModel: 'openai-3-large',

  async chunk(input: PylonTicketInput, ctx: ChunkContext): Promise<Chunk[]> {
    const parentExternalId = `pylon-ticket:${input.ticketId}`;
    const aclSubjects = [`org:${ctx.organizationId}`];
    const baseMetadata = {
      ticket_id: input.ticketId,
      ...(input.issueNumber !== undefined ? { issue_number: input.issueNumber } : {}),
      title: input.title,
      status: input.status,
      priority: input.priority,
      company_name: input.companyName,
      customer_name: input.customerName,
      customer_email: input.customerEmail,
      assignee_name: input.assigneeName,
      tags: input.tags,
      created_at: input.createdAt.toISOString(),
      updated_at: input.updatedAt.toISOString(),
    };

    const lines: string[] = [
      `# ${input.title}`,
      '',
      `Status: ${input.status}${input.priority ? ` | Priority: ${input.priority}` : ''}`,
    ];
    if (input.companyName) lines.push(`Company: ${input.companyName}`);
    if (input.customerName) {
      const email = input.customerEmail ? ` <${input.customerEmail}>` : '';
      lines.push(`Customer: ${input.customerName}${email}`);
    }
    if (input.assigneeName) lines.push(`Assignee: ${input.assigneeName}`);
    if (input.tags.length > 0) lines.push(`Tags: ${input.tags.join(', ')}`);
    lines.push(`Created: ${formatDate(input.createdAt)}`);
    lines.push('');

    const sortedMessages = [...input.messages].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

    for (const msg of sortedMessages) {
      const prefix = msg.authorType === 'customer' ? '>' : '';
      const label = `[${formatDate(msg.createdAt)}] ${msg.author}`;
      if (prefix) {
        lines.push(`${label} (customer):`);
        for (const bodyLine of msg.body.split('\n')) {
          lines.push(`> ${bodyLine}`);
        }
      } else {
        lines.push(`${label}:`);
        lines.push(msg.body);
      }
      lines.push('');
    }

    return [
      {
        content: lines.join('\n').trimEnd(),
        parentExternalId,
        metadata: baseMetadata,
        aclSubjects,
      },
    ];
  },
};
