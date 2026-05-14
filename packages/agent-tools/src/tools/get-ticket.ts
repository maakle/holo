import { z } from 'zod';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { resolveArtifactIdByExternalId } from './_artifact-lookup';

export const getTicketInputSchema = z.object({
  ticket_id: z.string().min(1),
});

export interface GetTicketToolContext {
  db: DB;
  organizationId: string;
  userSubjects: string[];
}

export async function runGetTicketTool(
  ctx: GetTicketToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getTicketInputSchema.parse(rawInput);
  const externalId = `pylon-ticket:${input.ticket_id}`;

  const artifactId = await resolveArtifactIdByExternalId(
    ctx.db,
    ctx.organizationId,
    externalId,
    ctx.userSubjects,
    `No ticket artifact for ticket_id ${input.ticket_id}`,
    'Verify the ticket has been ingested via the Pylon connector and you have access.',
  );
  const { chunks } = await getArtifact({
    db: ctx.db,
    artifactId,
    organizationId: ctx.organizationId,
  });
  const chunk = chunks[0]!;

  return {
    ticket_id: input.ticket_id,
    title: chunk.metadata['title'],
    status: chunk.metadata['status'],
    priority: chunk.metadata['priority'],
    company_name: chunk.metadata['company_name'],
    customer_name: chunk.metadata['customer_name'],
    assignee_name: chunk.metadata['assignee_name'],
    tags: chunk.metadata['tags'] ?? [],
    created_at: chunk.metadata['created_at'],
    updated_at: chunk.metadata['updated_at'],
    content: chunk.content,
  };
}
