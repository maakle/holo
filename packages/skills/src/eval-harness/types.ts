/**
 * Types shared across the per-skill regression eval harness.
 *
 * Distinct from `src/eval.ts` (ROUGE-L for synthesis evals) — this surface
 * grades *deterministic, structured expectations* promoted from user
 * feedback. No LLM-judge graders (RFC-0008 § Out of scope).
 */

/** Shape of `eval_entries.expected`. All arrays optional / may be empty. */
export interface EvalExpected {
  /** Every substring must appear in the answer (case-insensitive). */
  answer_substrings?: string[];
  /** Every chunk_id must appear in the answer's `citations[].chunk_id`. */
  must_cite?: string[];
  /** Every string must NOT appear in the answer (case-insensitive). */
  must_not_say?: string[];
}

/** One row pulled from the eval_entries table. */
export interface EvalEntry {
  id: string;
  organizationId: string;
  skillSlug: string | null;
  question: string;
  expected: EvalExpected;
  status: 'pending' | 'active' | 'archived';
}

/** A single agent answer the harness is grading. */
export interface AgentAnswer {
  answer: string;
  citations: { chunk_id: string }[];
}

/** Output of one grader against one (entry, answer) pair. */
export interface GraderResult {
  grader: 'answer_substring' | 'must_cite' | 'must_not_say';
  passed: boolean;
  /** Human-readable list of which expectations failed. Empty on pass. */
  failures: string[];
}

export interface EntryResult {
  entryId: string;
  passed: boolean;
  graders: GraderResult[];
}

export interface RunSummary {
  total: number;
  passed: number;
  passRate: number;
  perEntry: EntryResult[];
}
