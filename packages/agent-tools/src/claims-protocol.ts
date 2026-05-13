/**
 * Shared protocol for RFC-0007 (Hallucination Guardrails) across every
 * agent loop in the repo. Both `runChatAgentLoop` (web chat) and the
 * slack bot's `runAgent` register the same `emit_claims` terminal tool,
 * use the same system-prompt suffix, and run the same server-side
 * downgrade + hard-gate enforcement on the model's claims envelope.
 *
 * The web chat renders claims as inline confidence chips + a banner; the
 * slack bot has no UI for chips, so the user-visible signal there is the
 * "I couldn't verify N claims" footer that `appendUnverifiedNoteIfNeeded`
 * tacks onto the answer text when any unverified claims survived
 * enforcement. The data path is identical — the *renderer* differs.
 */
import type { AnswerClaim, ClaimConfidence } from './claims';
import { EMIT_CLAIMS_INPUT_SCHEMA, EMIT_CLAIMS_TOOL_NAME } from './claims';
import { requiresHardCitation } from './claims-classifier';

/**
 * Appended to whichever agent's base system prompt. Tells the model to
 * terminate by calling `emit_claims` with a structured claim breakdown
 * instead of a plain end_turn text reply.
 *
 * Phrased as a suffix (not a rewrite) so callers can keep their loop /
 * surface-specific guidance up top — the slack bot's slack-mrkdwn rule,
 * the web chat's "explaining which tools you used is welcome" line, etc.
 */
export const CLAIMS_SUFFIX = `

Claims protocol (REQUIRED):
- Instead of ending your turn with plain text, call the \`emit_claims\` tool exactly once with the final answer string AND a \`claims\` array.
- Each claim is a factual statement extracted from your answer. For each one:
  - \`text\`: the substring of the answer the claim covers.
  - \`confidence\`:
    - \`high\` — directly supported by a cited search result you can point to.
    - \`medium\` — inferred from cited material (combining two results, light reasoning).
    - \`low\` — informed guess based on general knowledge, not the indexed content.
    - \`unverified\` — you could not ground this in any indexed content; say so plainly in the answer too.
  - \`citation_indices\`: 1-based references into the same \`citations\` array the \`search\` tool returned. Empty for \`unverified\` / \`low\`.
  - \`reason\`: required for \`low\` / \`unverified\`; brief explanation.
- A claim with \`high\` confidence MUST have at least one citation index. The server will downgrade uncited high-confidence claims.
- Some claim types — quantitative customer facts (ARR/MRR/seat counts), product status ("X is shipped"), integration status ("Y is broken") — must be cited or marked \`unverified\`. The server enforces this.
- Non-factual conversational filler ("Sure, here's what I found:") does not need to be claimed.`;

/**
 * Declarative tool spec, agnostic of which LLM SDK each agent uses. The
 * web orchestrator builds an `LLMTool` from this; the slack bot's
 * `runAgent` builds an Anthropic `tool` from this.
 */
export const EMIT_CLAIMS_TOOL_DECL = {
  name: EMIT_CLAIMS_TOOL_NAME,
  description:
    'Terminate your turn with the final answer string and a structured array of claims (each with confidence and citation_indices). Call this exactly once instead of ending the turn with plain text.',
  inputSchema: EMIT_CLAIMS_INPUT_SCHEMA as unknown as Record<string, unknown>,
} as const;

/**
 * Parse the model's `emit_claims` tool input. Defensive against
 * missing/malformed fields — a partially valid envelope is better than a
 * hard failure mid-stream. Anything we can't make sense of is dropped,
 * not guessed.
 */
export function parseEmitClaimsInput(input: Record<string, unknown>): {
  answerText: string;
  claims: AnswerClaim[];
} {
  const answerText = typeof input['answer'] === 'string' ? input['answer'] : '';
  const rawClaims = Array.isArray(input['claims']) ? input['claims'] : [];
  const claims: AnswerClaim[] = [];
  for (const raw of rawClaims) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r['text'] === 'string' ? r['text'] : null;
    if (!text) continue;
    const conf = r['confidence'];
    const confidence: ClaimConfidence =
      conf === 'high' || conf === 'medium' || conf === 'low' || conf === 'unverified'
        ? conf
        : 'medium';
    const idxRaw = r['citation_indices'];
    const citationIndices: number[] = Array.isArray(idxRaw)
      ? (idxRaw.filter(
          (n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1,
        ) as number[])
      : [];
    const reason = typeof r['reason'] === 'string' ? r['reason'] : undefined;
    claims.push({
      text,
      confidence,
      citationIndices,
      ...(reason !== undefined ? { reason } : {}),
    });
  }
  return { answerText, claims };
}

/**
 * Apply the server-side guardrails to the model-emitted claims (RFC-0007):
 *
 *   1. A `high` claim with empty citations is downgraded to `medium` with
 *      `reason: 'no citation matched'`. (The model is fallible at the
 *      confidence step; we don't want one uncited "high" to pass.)
 *   2. A claim whose text matches {@link requiresHardCitation} and has
 *      empty citations is marked `unverified` with a stable reason. This
 *      is the hard-gate — refuse rather than guess.
 *
 * Order matters: hard-gate wins over downgrade, because hard-gated shapes
 * (revenue, product/integration status) are exactly where a silent
 * downgrade to `medium` would be most misleading.
 */
export function applyClaimGuardrails(claims: AnswerClaim[]): AnswerClaim[] {
  return claims.map((c) => {
    const uncited = c.citationIndices.length === 0;
    if (uncited && requiresHardCitation(c.text)) {
      return {
        ...c,
        confidence: 'unverified' as const,
        reason: c.reason ?? "couldn't verify against indexed content",
      };
    }
    if (uncited && c.confidence === 'high') {
      return {
        ...c,
        confidence: 'medium' as const,
        reason: c.reason ?? 'no citation matched',
      };
    }
    return c;
  });
}

const UNVERIFIED_NOTE_PREFIX = "Note: I couldn't verify";

/**
 * If any claim ended up `unverified` and the answer doesn't already say
 * so, append a single explanatory line. We keep the wording mechanical
 * — the web UI banner is the primary signal there; this is the textual
 * fallback for surfaces (REST, slack bot) that don't render claim chips.
 */
export function appendUnverifiedNoteIfNeeded(
  answer: string,
  claims: AnswerClaim[],
): string {
  const unverifiedCount = claims.filter((c) => c.confidence === 'unverified').length;
  if (unverifiedCount === 0) return answer;
  if (answer.includes(UNVERIFIED_NOTE_PREFIX)) return answer;
  const noun = unverifiedCount === 1 ? 'one claim' : `${unverifiedCount} claims`;
  const suffix = `\n\n${UNVERIFIED_NOTE_PREFIX} ${noun} above against your indexed content.`;
  return `${answer}${suffix}`;
}
