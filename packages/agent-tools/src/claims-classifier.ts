/**
 * Hard-gate classifier (RFC-0007 Hallucination Guardrails).
 *
 * Heuristic — keyword + regex — that flags claim shapes the org would
 * rather refuse than guess at. When a flagged claim has no citations, the
 * orchestrator marks it `unverified` and appends a "couldn't verify" note
 * to the answer.
 *
 * Three categories, hand-curated:
 *   - Quantitative customer claims (ARR / MRR / seat / ticket counts near
 *     a customer mention).
 *   - Product-status claims ("X is shipped", "Y is on the roadmap", ...).
 *   - Integration-status claims ("integration is broken", "X works", ...).
 *
 * Intentionally not exhaustive. A model-grader would be the right tool;
 * RFC-0007 says heuristic only. See "Out of scope" in the RFC.
 */

// --- 1. Quantitative customer claims --------------------------------------
//
// We look for a money/seat/ticket figure within a short window of a customer
// signal. The customer signal can be:
//   - an explicit word: "customer", "client", "account", "deal"
//   - a possessive that implies one ("their ARR", "the customer's MRR")
//
// Quantitative cue:
//   - currency symbol or amount with K/M/B suffix
//   - "N seats", "N users", "N tickets" (case-insensitive)
//   - "ARR", "MRR" appearing anywhere — these are almost always a
//     customer-revenue claim in this context.
//
// We use a single regex pass with broad disjunctions rather than a
// neighborhood scan; that keeps the rule debuggable and matches the
// "don't over-engineer" guidance in the implementation plan.

const QUANTITATIVE_CUSTOMER_PATTERNS: RegExp[] = [
  // ARR / MRR almost always means a revenue claim in this product surface.
  /\b(?:ARR|MRR)\b/,
  // "$120k", "$1.2M", "USD 50000" — currency or amount with magnitude suffix.
  /(?:\$|€|£|USD\s*|EUR\s*|GBP\s*)\d[\d,]*(?:\.\d+)?\s*[kKmMbB]?\b/,
  // "120 seats", "45 users", "300 tickets" — usage volume claims.
  /\b\d[\d,]*\s+(?:seats?|users?|tickets?|licen[cs]es?)\b/i,
];

// --- 2. Product-status claims ---------------------------------------------
//
// Variants of "X is shipped", "Y is on the roadmap", "Z is launched / in
// beta / deprecated / GA". Negated forms ("isn't shipped") are still
// claims about product status, so we include them.

const PRODUCT_STATUS_PATTERNS: RegExp[] = [
  /\bis\s+(?:not\s+)?(?:shipped|launched|live|in\s+beta|in\s+GA|generally\s+available|deprecated|sunset|released|rolled\s+out)\b/i,
  /\b(?:isn't|is\s+not|hasn't\s+been|has\s+not\s+been)\s+(?:shipped|launched|released)\b/i,
  /\bon\s+the\s+roadmap\b/i,
  /\bcoming\s+(?:soon|in\s+Q[1-4])\b/i,
  /\b(?:we|holo)\s+(?:shipped|launched|released|GA(?:'?d)?)\b/i,
];

// --- 3. Integration-status claims -----------------------------------------
//
// "X integration is broken", "Slack works", "Notion is offline / down /
// failing / unreliable". Note the asymmetry — both positive and negative
// status assertions need a citation, because "Slack works" is just as
// load-bearing as "Slack is broken" when the customer is debugging.

const INTEGRATION_STATUS_PATTERNS: RegExp[] = [
  /\b(?:integration|connector|sync)\s+(?:is|are)\s+(?:broken|offline|down|failing|degraded|unreliable|not\s+working)\b/i,
  /\b(?:integration|connector|sync)\s+(?:works|is\s+working|is\s+up|is\s+online|is\s+healthy)\b/i,
  // "Slack is broken / offline / works"
  /\b(?:slack|notion|github|jira|confluence|salesforce|hubspot|pylon|grain|stripe|google\s*drive|gdrive|airtable|prismic)\s+(?:is|are)\s+(?:broken|offline|down|failing|degraded|not\s+working|working|healthy|up|online)\b/i,
];

const ALL_PATTERNS: ReadonlyArray<{ category: string; pattern: RegExp }> = [
  ...QUANTITATIVE_CUSTOMER_PATTERNS.map((p) => ({
    category: 'quantitative_customer',
    pattern: p,
  })),
  ...PRODUCT_STATUS_PATTERNS.map((p) => ({ category: 'product_status', pattern: p })),
  ...INTEGRATION_STATUS_PATTERNS.map((p) => ({
    category: 'integration_status',
    pattern: p,
  })),
];

/**
 * Returns true if `claimText` looks like one of the hard-gated claim
 * shapes. Conservative: matches any of the curated patterns.
 *
 * Cheap to call repeatedly — small regex list, single pass per pattern.
 */
export function requiresHardCitation(claimText: string): boolean {
  if (!claimText) return false;
  for (const { pattern } of ALL_PATTERNS) {
    if (pattern.test(claimText)) return true;
  }
  return false;
}

/**
 * Inspection helper for tests/diagnostics. Returns the matched category
 * names for the claim, in match order. Empty if no pattern matched.
 */
export function classifyClaim(claimText: string): string[] {
  const matched: string[] = [];
  if (!claimText) return matched;
  for (const { category, pattern } of ALL_PATTERNS) {
    if (pattern.test(claimText) && !matched.includes(category)) {
      matched.push(category);
    }
  }
  return matched;
}
