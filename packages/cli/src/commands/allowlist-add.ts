import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

const PROVIDERS = new Set(['github', 'slack', 'notion'] as const);
type Provider = 'github' | 'slack' | 'notion';

export interface RunAllowlistAddInput {
  db: DB;
  organizationId: string;
  provider: Provider;
  pattern: string;
  exclude: boolean;
  note?: string;
  /** Optional override for created_by (defaults to first user in the org). */
  createdBy?: string;
}

function detectKind(pattern: string): 'glob' | 'exact_id' {
  return pattern.includes('*') || pattern.includes('?') ? 'glob' : 'exact_id';
}

export async function runAllowlistAdd(input: RunAllowlistAddInput): Promise<string> {
  if (!PROVIDERS.has(input.provider)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `unknown provider '${input.provider}'`,
      fix: 'Use one of: github, slack, notion',
    });
  }

  let createdBy = input.createdBy;
  if (!createdBy) {
    const userRow = await input.db.execute<{ id: string }>(sql`
      SELECT id FROM "user" LIMIT 1
    `);
    const rows = (userRow as unknown as { rows?: Array<{ id: string }> }).rows
      ?? (userRow as unknown as Array<{ id: string }>);
    if (!rows || rows.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: 'no user rows found — cannot resolve created_by',
        fix: 'Sign up at least one user via the dashboard before adding allowlist entries.',
      });
    }
    createdBy = rows[0]!.id;
  }

  const result = await input.db.execute<{ id: string }>(sql`
    INSERT INTO connector_allowlists
      (organization_id, provider, pattern, pattern_kind, decision, created_by, notes)
    VALUES (
      ${input.organizationId},
      ${input.provider},
      ${input.pattern},
      ${detectKind(input.pattern)},
      ${input.exclude ? 'exclude' : 'include'},
      ${createdBy},
      ${input.note ?? null}
    )
    RETURNING id
  `);
  const rows = (result as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (result as unknown as Array<{ id: string }>);
  return rows[0]!.id;
}
