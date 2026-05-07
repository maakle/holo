import { and, eq } from 'drizzle-orm';
import { minimatch } from 'minimatch';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { ErrorCode, holoError } from '@holo/errors';

export interface ResolveAllowlistInput {
  db: DB;
  organizationId: string;
  provider: 'github' | 'slack' | 'notion';
  candidates?: string[];
}

export interface AllowlistResult {
  /** All include-decision rows */
  include: AllowlistRow[];
  /** All exclude-decision rows */
  exclude: AllowlistRow[];
  /**
   * Resolved set of allowed entries.
   * If `candidates` was provided, this is the subset that passed.
   * If no candidates were provided, this is the include patterns themselves
   * (after filtering out those blocked by an exclude row).
   */
  resolved: string[];
  /** Returns true iff the given candidate is allowed by the allowlist. */
  matches: (candidate: string) => boolean;
}

export interface AllowlistRow {
  id: string;
  pattern: string;
  patternKind: 'glob' | 'exact_id';
  decision: 'include' | 'exclude';
}

function rowMatches(candidate: string, row: AllowlistRow): boolean {
  if (row.patternKind === 'exact_id') {
    return candidate === row.pattern;
  }
  // glob
  return minimatch(candidate, row.pattern);
}

/**
 * Pure allowlist evaluator. Pulled out of resolveAllowlist so the framework's
 * connector specs can match against rows surfaced via ctx.allowlist without
 * needing a Drizzle handle. The legacy db-backed `resolveAllowlist` reuses
 * this function.
 */
export function evaluateAllowlist(
  rows: ReadonlyArray<{
    pattern: string;
    patternKind: 'glob' | 'exact_id';
    decision: 'include' | 'exclude';
  }>,
  options: { provider: string; organizationId: string; candidates?: string[] },
): AllowlistResult {
  const include = rows.filter((r) => r.decision === 'include') as AllowlistRow[];
  const exclude = rows.filter((r) => r.decision === 'exclude') as AllowlistRow[];

  if (include.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
      problem: `No 'include' allowlist entries for provider '${options.provider}'`,
      cause: `provider=${options.provider} organizationId=${options.organizationId}`,
      fix: `Add at least one entry: \`holo allowlist add ${options.provider} <pattern>\``,
    });
  }

  function matches(candidate: string): boolean {
    const included = include.some((row) => rowMatches(candidate, row));
    if (!included) return false;
    const excluded = exclude.some((row) => rowMatches(candidate, row));
    return !excluded;
  }

  let resolved: string[];
  if (options.candidates !== undefined) {
    resolved = options.candidates.filter((c) => matches(c));
  } else {
    resolved = include.map((r) => r.pattern).filter((p) => matches(p));
  }

  if (resolved.length > 50) {
    throw holoError({
      code: ErrorCode.HOLO_ALLOWLIST_OVERSIZED,
      problem: `Allowlist for provider '${options.provider}' resolves to ${resolved.length} entries (max 50)`,
      cause: `provider=${options.provider} organizationId=${options.organizationId} resolved=${resolved.length}`,
      fix: `Narrow your allowlist patterns or remove some entries so the resolved set is ≤50.`,
    });
  }

  return { include, exclude, resolved, matches };
}

export async function resolveAllowlist(input: ResolveAllowlistInput): Promise<AllowlistResult> {
  const { db, organizationId, provider, candidates } = input;

  const rows = await db
    .select({
      id: schema.connectorAllowlists.id,
      pattern: schema.connectorAllowlists.pattern,
      patternKind: schema.connectorAllowlists.patternKind,
      decision: schema.connectorAllowlists.decision,
    })
    .from(schema.connectorAllowlists)
    .where(
      and(
        eq(schema.connectorAllowlists.organizationId, organizationId),
        eq(schema.connectorAllowlists.provider, provider),
      ),
    );

  return evaluateAllowlist(rows, { provider, organizationId, candidates });
}
