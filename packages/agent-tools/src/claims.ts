/**
 * Structured claims envelope for chat answers (RFC-0007 Hallucination Guardrails).
 *
 * Each assistant turn (when `requireClaims` is enabled on the orchestrator)
 * carries a `claims[]` array alongside the answer text. Each claim is a
 * substring of the answer, tagged with a confidence level and a list of
 * citation indices (referencing the same 1-based namespace used by
 * `citations[]` — see `citations.ts` / PR #188).
 *
 * Server-side enforcement (in the orchestrator) downgrades high-confidence
 * claims with no citations to `medium`, and hard-gates a curated set of
 * claim shapes (quantitative customer facts, product/integration status)
 * to `unverified` when uncited. See `claims-classifier.ts`.
 *
 * Wire convention mirrors `citations.ts`: snake_case at the wire,
 * camelCase TS internal. No persistence — claims live for the lifetime of
 * one chat answer.
 */

export type ClaimConfidence = 'high' | 'medium' | 'low' | 'unverified';

export interface AnswerClaim {
  /**
   * A substring of the answer text this claim covers. The orchestrator
   * doesn't currently verify that `text` is in fact a substring — that's
   * a UI-side concern for chip placement, and we don't want to drop a
   * useful claim just because the model paraphrased.
   */
  text: string;
  confidence: ClaimConfidence;
  /**
   * 1-based references into the turn-global `citations[]` array. Empty for
   * unverified / low claims, or for `medium` claims that the model chose
   * not to cite.
   */
  citationIndices: number[];
  /** Optional human-readable reason for `low` / `unverified` / downgraded
   * confidence. Filled in by the server when it downgrades; the model may
   * also set it. */
  reason?: string;
}

/**
 * Wire-format (snake_case) projection of `AnswerClaim`. Returned in the
 * streaming `done` event and the REST chat response so the web client can
 * render chips inline.
 */
export interface WireAnswerClaim {
  text: string;
  confidence: ClaimConfidence;
  citation_indices: number[];
  reason?: string;
}

export function claimToWire(c: AnswerClaim): WireAnswerClaim {
  return {
    text: c.text,
    confidence: c.confidence,
    citation_indices: [...c.citationIndices],
    ...(c.reason !== undefined ? { reason: c.reason } : {}),
  };
}

export function claimFromWire(w: WireAnswerClaim): AnswerClaim {
  return {
    text: w.text,
    confidence: w.confidence,
    citationIndices: [...w.citation_indices],
    ...(w.reason !== undefined ? { reason: w.reason } : {}),
  };
}

/**
 * JSON-schema for the `emit_claims` tool the orchestrator registers when
 * `requireClaims` is true. The model emits this as its final step instead
 * of (or alongside) plain end_turn text.
 */
export const EMIT_CLAIMS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description:
              'A substring of the answer this claim covers. Quote the answer faithfully.',
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low', 'unverified'],
            description:
              "high = directly supported by a cited search result; medium = inferred from cited material; low = informed guess; unverified = couldn't ground this in indexed content.",
          },
          citation_indices: {
            type: 'array',
            items: { type: 'integer', minimum: 1 },
            description:
              '1-based indices into the citations[] array the search tool returned. Empty for unverified/low claims that lack a cite.',
          },
          reason: {
            type: 'string',
            description:
              'Optional explanation for low/unverified confidence. Free text.',
          },
        },
        required: ['text', 'confidence', 'citation_indices'],
      },
    },
    answer: {
      type: 'string',
      description:
        'The final answer text shown to the user. Use bracket-ref citations like [1] for cited facts, same as the previous protocol.',
    },
  },
  required: ['claims', 'answer'],
} as const;

export const EMIT_CLAIMS_TOOL_NAME = 'emit_claims';
