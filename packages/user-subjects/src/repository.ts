import { eq, and } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import type { ReplaceSubjectsInput } from './types';

export async function getSubjectsForUser(db: DB, userId: string): Promise<string[]> {
  const rows = await db
    .select({ subject: schema.userSubjectsCache.subject })
    .from(schema.userSubjectsCache)
    .where(eq(schema.userSubjectsCache.userId, userId));
  return rows.map((r) => r.subject).sort();
}

export async function replaceSubjectsForUser(
  db: DB,
  input: ReplaceSubjectsInput,
): Promise<void> {
  // Dedupe inputs so we don't try to insert the same (user_id, subject) twice.
  const unique = Array.from(new Set(input.subjects));

  await db.transaction(async (tx) => {
    // Drop only this source's rows for this user.
    await tx
      .delete(schema.userSubjectsCache)
      .where(
        and(
          eq(schema.userSubjectsCache.userId, input.userId),
          eq(schema.userSubjectsCache.source, input.source),
        ),
      );

    if (unique.length === 0) return;

    await tx.insert(schema.userSubjectsCache).values(
      unique.map((subject) => ({
        userId: input.userId,
        organizationId: input.organizationId,
        subject,
        source: input.source,
      })),
    );
  });
}
