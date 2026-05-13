/**
 * Three deterministic graders the regression harness runs against each
 * (eval_entry, agent_answer) pair. All graders are pure functions: same
 * inputs, same result, no LLM, no network. Out-of-scope by RFC-0008.
 */

import type { AgentAnswer, EvalExpected, GraderResult } from './types';

/** Every `answer_substrings` entry must appear in `answer` (case-insensitive). */
export function answerSubstringGrader(
  expected: EvalExpected,
  answer: AgentAnswer,
): GraderResult {
  const subs = expected.answer_substrings ?? [];
  const haystack = answer.answer.toLowerCase();
  const failures: string[] = [];
  for (const needle of subs) {
    if (!haystack.includes(needle.toLowerCase())) failures.push(needle);
  }
  return { grader: 'answer_substring', passed: failures.length === 0, failures };
}

/** Every chunk_id in `must_cite` must appear in `citations[].chunk_id`. */
export function mustCiteGrader(
  expected: EvalExpected,
  answer: AgentAnswer,
): GraderResult {
  const required = expected.must_cite ?? [];
  const cited = new Set(answer.citations.map((c) => c.chunk_id));
  const failures = required.filter((id) => !cited.has(id));
  return { grader: 'must_cite', passed: failures.length === 0, failures };
}

/** No string in `must_not_say` may appear in `answer` (case-insensitive). */
export function mustNotSayGrader(
  expected: EvalExpected,
  answer: AgentAnswer,
): GraderResult {
  const forbidden = expected.must_not_say ?? [];
  const haystack = answer.answer.toLowerCase();
  const failures = forbidden.filter((s) => haystack.includes(s.toLowerCase()));
  return { grader: 'must_not_say', passed: failures.length === 0, failures };
}

export const ALL_GRADERS = [
  answerSubstringGrader,
  mustCiteGrader,
  mustNotSayGrader,
] as const;
