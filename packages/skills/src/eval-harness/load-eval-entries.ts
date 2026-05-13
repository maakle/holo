/**
 * Loader: pulls active `eval_entries` rows for a given org × skill.
 *
 * Filters: `organization_id = $org`, `skill_slug = $slug`, `status = 'active'`.
 * Pending and archived rows are excluded — only entries an owner has
 * promoted-and-activated count toward the regression pass-rate.
 */

import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type { EvalEntry, EvalExpected } from './types';

export interface LoadEvalEntriesInput {
  organizationId: string;
  skillSlug: string;
  /** Default 'active' — overridable for the inbox UI which wants `pending`. */
  status?: 'pending' | 'active' | 'archived';
}

export async function loadEvalEntries(
  db: DB,
  input: LoadEvalEntriesInput,
): Promise<EvalEntry[]> {
  const status = input.status ?? 'active';
  const rows = await db
    .select({
      id: schema.evalEntries.id,
      organizationId: schema.evalEntries.organizationId,
      skillSlug: schema.evalEntries.skillSlug,
      question: schema.evalEntries.question,
      expected: schema.evalEntries.expected,
      status: schema.evalEntries.status,
    })
    .from(schema.evalEntries)
    .where(
      and(
        eq(schema.evalEntries.organizationId, input.organizationId),
        eq(schema.evalEntries.skillSlug, input.skillSlug),
        eq(schema.evalEntries.status, status),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    skillSlug: r.skillSlug,
    question: r.question,
    expected: (r.expected ?? {}) as EvalExpected,
    status: r.status as 'pending' | 'active' | 'archived',
  }));
}
