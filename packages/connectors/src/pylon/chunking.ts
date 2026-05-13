/**
 * Pylon ticket → chunk projection. Each ticket produces one or more chunks
 * via @holo/chunker's pylonTicketChunker; this module just maps the API
 * response shape into the chunker's input and pushes results through ctx.upsert.
 */
import { pylonTicketChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';
import {
  CUSTOMER_ACCOUNT_HINT_KEY,
  type CustomerAccountResolveHint,
} from '../shared/customer-accounts';
import { listAllMessages } from './api';
import type { PylonIssue, PylonMessage } from './types';

function emailDomain(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.lastIndexOf('@');
  if (at < 0 || at === email.length - 1) return undefined;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || undefined;
}

function deriveAuthorType(
  author: PylonMessage['author'],
): 'agent' | 'customer' | 'bot' {
  if (author.user) return 'agent';
  if (author.contact) return 'customer';
  return 'bot';
}

/**
 * Index one ticket: fetch its message thread, project to the chunker's
 * input, and emit each resulting chunk via ctx.upsert. Tickets continue to
 * be indexed (with title/body alone) when the messages call fails.
 */
export async function processTicket(
  ctx: ResourceSyncContext<unknown>,
  issue: PylonIssue,
): Promise<void> {
  let messages: PylonMessage[] = [];
  try {
    messages = await listAllMessages(ctx.api, issue.id);
  } catch {
    /* skip messages — ticket is still indexed via title/body */
  }

  const ticketInput = {
    ticketId: issue.id,
    issueNumber: issue.number,
    title: issue.title,
    status: issue.state,
    priority: undefined,
    createdAt: new Date(issue.created_at),
    updatedAt: new Date(issue.updated_at),
    customerName: issue.requester?.email,
    customerEmail: issue.requester?.email,
    companyName: undefined,
    assigneeName: issue.assignee?.email,
    tags: issue.tags ?? [],
    messages: messages.map((m) => ({
      id: m.id,
      author: m.author.name,
      authorType: deriveAuthorType(m.author),
      createdAt: new Date(m.timestamp),
      body: m.message_html,
    })),
  };

  const sourceArtifactId = `pylon-ticket:${issue.id}`;
  const rawChunks = await pylonTicketChunker.chunk(ticketInput, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });

  // Pylon doesn't expose accounts as a separate sync resource yet, so we
  // can't upsert a canonical customer_accounts row from this connector.
  // We do the next-best thing: emit a domain hint derived from the
  // requester's email, which the resolver will match against any
  // customer_accounts row already populated from HubSpot/Salesforce.
  const domain = emailDomain(issue.requester?.email);
  const accountHint: { [CUSTOMER_ACCOUNT_HINT_KEY]?: CustomerAccountResolveHint } = domain
    ? { [CUSTOMER_ACCOUNT_HINT_KEY]: { domain } }
    : {};

  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: issue.id,
      kind: 'pylon-ticket',
      content: c.content,
      metadata: { ...c.metadata, ...accountHint },
      aclSubjects: c.aclSubjects,
    });
  }
}
