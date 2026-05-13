/**
 * Fuzzy customer-account resolution for *user-facing* lookups.
 *
 * Companion to `customer-accounts.ts`, which handles *ingest-time* resolution
 * via metadata hints from connectors. This module answers the chat/skill
 * question "the user typed 'Skello' — which `customer_accounts.id` is that?"
 * without forcing the caller to know the UUID.
 *
 * The resolution order is intentionally deterministic and cheap so the chat
 * path can call it without an LLM hop:
 *
 *   1. UUID fast path — if `query` is already a `customer_accounts.id`, return.
 *   2. Exact display_name (case-insensitive).
 *   3. Exact alias match (case-insensitive scan of the `aliases` text[]).
 *   4. Primary domain or domains[] exact match (case-insensitive).
 *   5. Prefix match on display_name (LIKE 'query%').
 *
 * Returns the best match, plus any other candidates within the same tier so
 * the caller can disambiguate ("did you mean Skello or Skello-Test?"). The
 * RFC-0003 fuzzy/LLM-driven resolver wraps this — if structured matches come
 * up empty or ambiguous, the caller falls back to a tiny classifier prompt.
 */
import { holoError, ErrorCode } from '@holo/errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sql = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedAccountCandidate {
  id: string;
  displayName: string;
  primaryDomain: string | null;
  aliases: string[];
  /** Which heuristic produced this candidate — useful for telemetry and
   * for the disambiguation UI. */
  matchedBy: 'uuid' | 'display_name' | 'alias' | 'domain' | 'prefix';
}

export interface ResolveAccountInput {
  organizationId: string;
  /** User-typed string — display name, alias, domain, or UUID. Trimmed by
   * the resolver; empty strings throw. */
  query: string;
}

export interface ResolveAccountResult {
  /** Best single candidate, or null when nothing matched. */
  match: ResolvedAccountCandidate | null;
  /** All candidates that tied with the best match (same `matchedBy` tier).
   * Length 0 when nothing matched, 1 for an unambiguous hit, >1 when the
   * caller needs to disambiguate. */
  candidates: ResolvedAccountCandidate[];
}

interface CustomerAccountRow {
  id: string;
  display_name: string;
  primary_domain: string | null;
  domains: string[] | null;
  aliases: string[] | null;
}

/**
 * Walk the resolution tiers in order; stop at the first tier that returns
 * at least one match. Candidates from a tier are not merged with the next
 * tier — exact matches always beat prefix matches.
 */
export async function resolveCustomerAccount(
  sql: Sql,
  input: ResolveAccountInput,
): Promise<ResolveAccountResult> {
  const q = input.query.trim();
  if (q.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'resolveCustomerAccount: query is empty',
      fix: 'Pass a non-empty string (display name, alias, domain, or UUID).',
    });
  }

  // Tier 1: UUID fast path. We still verify the row exists *and* belongs to
  // the org — the caller might have an ID from a different tenant.
  if (UUID_RE.test(q)) {
    const rows = await sql<CustomerAccountRow[]>`
      SELECT id, display_name, primary_domain, domains, aliases
      FROM customer_accounts
      WHERE organization_id = ${input.organizationId} AND id = ${q}
      LIMIT 1
    `;
    if (rows.length > 0) {
      const cand = rowToCandidate(rows[0]!, 'uuid');
      return { match: cand, candidates: [cand] };
    }
    return { match: null, candidates: [] };
  }

  const qLower = q.toLowerCase();

  // Tier 2: exact display_name (case-insensitive).
  const byDisplay = await sql<CustomerAccountRow[]>`
    SELECT id, display_name, primary_domain, domains, aliases
    FROM customer_accounts
    WHERE organization_id = ${input.organizationId}
      AND LOWER(display_name) = ${qLower}
    ORDER BY display_name
    LIMIT 10
  `;
  if (byDisplay.length > 0) {
    return resultFromRows(byDisplay, 'display_name');
  }

  // Tier 3: exact alias match (case-insensitive). The `aliases` array is
  // stored mixed-case; we unnest and compare lower-cased.
  const byAliasCandidates = await sql<CustomerAccountRow[]>`
    SELECT id, display_name, primary_domain, domains, aliases
    FROM customer_accounts
    WHERE organization_id = ${input.organizationId}
      AND EXISTS (
        SELECT 1 FROM unnest(aliases) AS a
        WHERE LOWER(a) = ${qLower}
      )
    ORDER BY display_name
    LIMIT 10
  `;
  if (byAliasCandidates.length > 0) {
    return resultFromRows(byAliasCandidates, 'alias');
  }

  // Tier 4: primary domain or domains[] entry exact match.
  if (looksLikeDomain(q)) {
    const byDomain = await sql<CustomerAccountRow[]>`
      SELECT id, display_name, primary_domain, domains, aliases
      FROM customer_accounts
      WHERE organization_id = ${input.organizationId}
        AND (
          LOWER(primary_domain) = ${qLower}
          OR domains && ARRAY[${qLower}]::text[]
        )
      ORDER BY display_name
      LIMIT 10
    `;
    if (byDomain.length > 0) {
      return resultFromRows(byDomain, 'domain');
    }
  }

  // Tier 5: prefix match on display_name. Last resort — bounded by LIMIT 5 so
  // an unhelpful one-character query doesn't return half the table.
  const byPrefix = await sql<CustomerAccountRow[]>`
    SELECT id, display_name, primary_domain, domains, aliases
    FROM customer_accounts
    WHERE organization_id = ${input.organizationId}
      AND LOWER(display_name) LIKE ${qLower + '%'}
    ORDER BY display_name
    LIMIT 5
  `;
  if (byPrefix.length > 0) {
    return resultFromRows(byPrefix, 'prefix');
  }

  return { match: null, candidates: [] };
}

function resultFromRows(
  rows: CustomerAccountRow[],
  matchedBy: ResolvedAccountCandidate['matchedBy'],
): ResolveAccountResult {
  const candidates = rows.map((r) => rowToCandidate(r, matchedBy));
  return { match: candidates[0] ?? null, candidates };
}

function rowToCandidate(
  row: CustomerAccountRow,
  matchedBy: ResolvedAccountCandidate['matchedBy'],
): ResolvedAccountCandidate {
  return {
    id: row.id,
    displayName: row.display_name,
    primaryDomain: row.primary_domain,
    aliases: row.aliases ?? [],
    matchedBy,
  };
}

function looksLikeDomain(q: string): boolean {
  // Cheap heuristic — "skello.io" yes, "Skello SA" no. We don't try to be
  // exhaustive; the cost of a missed domain is one extra fallback query.
  return /\./.test(q) && !/\s/.test(q);
}
