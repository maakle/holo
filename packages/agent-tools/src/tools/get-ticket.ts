import { z } from 'zod';
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { getArtifact } from '@holo/retrieval-core';
import { holoError, ErrorCode } from '@holo/errors';

export const getTicketInputSchema = z.object({
  ticket_id: z.string().min(1),
});

export interface GetTicketToolContext {
  db: DB;
  organizationId: string;
}

export async function runGetTicketTool(
  ctx: GetTicketToolContext,
  rawInput: unknown,
): Promise<Record<string, unknown>> {
  const input = getTicketInputSchema.parse(rawInput);
  const externalId = `pylon-ticket:${input.ticket_id}`;

  const result = await ctx.db.execute<{ id: string } & Record<string, unknown>>(sql`
    SELECT id FROM source_artifacts
    WHERE organization_id = ${ctx.organizationId} AND external_id = ${externalId}
    LIMIT 1
  `);
  const rows = ((result as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (result as unknown as Array<{ id: string }>)) ?? [];
  if (rows.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
      problem: `No ticket artifact for ticket_id ${input.ticket_id}`,
      fix: 'Verify the ticket has been ingested via the Pylon connector.',
    });
  }
  const artifactId = rows[0]!.id;
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
