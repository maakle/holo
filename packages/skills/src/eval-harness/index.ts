/**
 * Per-skill regression eval harness (RFC-0008).
 *
 * Wiring:
 *   1. `loadEvalEntries(db, { organizationId, skillSlug })` → active entries.
 *   2. Caller runs the agent once per entry → produces `AgentAnswer`s.
 *   3. `runHarness(entries, answerFor)` → `RunSummary` (pass rate + per-entry).
 *   4. Persist a row to `skill_eval_runs` (the regression panel reads this).
 *
 * Pure: no DB writes in this module. The orchestration of step 2 (calling
 * the live agent) lives in the worker/route handler so we can swap in a
 * stub for tests.
 */

import {
  answerSubstringGrader,
  mustCiteGrader,
  mustNotSayGrader,
} from './graders';
import type {
  AgentAnswer,
  EntryResult,
  EvalEntry,
  RunSummary,
} from './types';

export type AnswerFor = (entry: EvalEntry) => Promise<AgentAnswer>;

export async function runHarness(
  entries: EvalEntry[],
  answerFor: AnswerFor,
): Promise<RunSummary> {
  const perEntry: EntryResult[] = [];
  for (const entry of entries) {
    const answer = await answerFor(entry);
    const graders = [
      answerSubstringGrader(entry.expected, answer),
      mustCiteGrader(entry.expected, answer),
      mustNotSayGrader(entry.expected, answer),
    ];
    perEntry.push({
      entryId: entry.id,
      passed: graders.every((g) => g.passed),
      graders,
    });
  }

  const total = perEntry.length;
  const passed = perEntry.filter((r) => r.passed).length;
  const passRate = total === 0 ? 0 : passed / total;
  return { total, passed, passRate, perEntry };
}

export * from './graders';
export * from './load-eval-entries';
export * from './types';
