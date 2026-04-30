import { createHash } from 'node:crypto';
import { inArray, eq, and } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export function chunkHash(kind: string, content: string): string {
  return createHash('sha256').update(`${kind}:${content}`).digest('hex');
}

export interface DedupeAgainstDbInput {
  db: DB;
  organizationId: string;
  hashes: string[];
}

export async function dedupeAgainstDb(input: DedupeAgainstDbInput): Promise<string[]> {
  if (input.hashes.length === 0) return [];

  const rows = await input.db
    .select({ contentHash: schema.chunks.contentHash })
    .from(schema.chunks)
    .where(
      and(
        eq(schema.chunks.organizationId, input.organizationId),
        inArray(schema.chunks.contentHash, input.hashes),
      ),
    );

  const existing = new Set(rows.map((r) => r.contentHash));
  return input.hashes.filter((h) => !existing.has(h));
}
