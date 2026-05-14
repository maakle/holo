/**
 * Cross-call citation renumbering for the `search` tool.
 *
 * One agent turn can make multiple `search` calls, each emitting a 1-based
 * `citations[]` array starting at 1. The orchestrator wants a single
 * monotonic citation namespace across the whole turn so the model can refer
 * to `[7]` and we can map that back to exactly one citation.
 *
 * `renumberSearchOutput` mutates the indices on the in-flight tool output
 * before it reaches the model (via JSON.stringify) AND records each
 * renumbered citation in the caller's accumulator for the final answer.
 *
 * Shared between web (`chat-orchestrator.ts`) and slack-bot (`agent.ts`) so
 * both surfaces apply identical numbering — and `[N]` in the answer text
 * resolves to the same citation regardless of which loop produced it.
 */
import type { WireCitation } from './citations';
import type { WireSearchCoverage } from './coverage-wire';

/**
 * Rewrite the `citations[].index` field on a `search` tool's output so the
 * indices count up from where the prior search call left off. Returns a
 * shallow-cloned output with the renumbered citations array; leaves all
 * other fields (including `results[]` and `coverage`) untouched.
 *
 * Defensive against malformed tool outputs: if the shape doesn't match
 * (e.g. a test stub returned something else under the `search` name), we
 * pass the value through untouched.
 */
export function renumberSearchOutput(
  rawOutput: unknown,
  citationsAcc: WireCitation[],
  coverageAcc: WireSearchCoverage[],
): unknown {
  if (!rawOutput || typeof rawOutput !== 'object') return rawOutput;
  const out = rawOutput as { citations?: unknown; coverage?: unknown };
  if (out.coverage && typeof out.coverage === 'object') {
    coverageAcc.push(out.coverage as WireSearchCoverage);
  }
  if (!Array.isArray(out.citations)) return rawOutput;
  const offset = citationsAcc.length;
  const renumbered = out.citations.map((c, i) => {
    const cit = c as WireCitation;
    const renumberedCit: WireCitation = { ...cit, index: offset + i + 1 };
    citationsAcc.push(renumberedCit);
    return renumberedCit;
  });
  return { ...out, citations: renumbered };
}
