import 'server-only';
import { AnthropicLLMClient } from '@holo/llm';
import { runChatAgentLoop } from '@holo/agent-tools/chat';
import { runHarness, loadEvalEntries, type EvalEntry } from '@holo/skills/server';
import { schema, type DB } from '@holo/db';
import { getSubjectsForUser } from '@holo/user-subjects';
import { CHAT_MODEL_ID } from './chat-model';

/**
 * Run the regression harness for a single skill, persist a roll-up row,
 * and return the summary. Shared by:
 *   - on-demand "run now" from the skill detail page (route handler)
 *   - the nightly BullMQ cron in apps/worker
 *
 * The eval pulls only `status='active'` entries; if there are zero, the
 * run is a no-op (no row written) so an empty harness doesn't pollute
 * the regression sparkline.
 */
export async function runSkillEval(opts: {
  db: DB;
  organizationId: string;
  /** Used to scope retrieval ACL during the agent loop. */
  userId: string;
  skillSlug: string;
  anthropicApiKey: string;
}): Promise<{
  total: number;
  passed: number;
  passRate: number;
  ranAt: string;
  perEntry: Array<{ entryId: string; passed: boolean }>;
} | null> {
  const entries = await loadEvalEntries(opts.db, {
    organizationId: opts.organizationId,
    skillSlug: opts.skillSlug,
  });
  if (entries.length === 0) return null;

  const extraSubjects = await getSubjectsForUser(opts.db, opts.userId);
  const userSubjects = [
    `org:${opts.organizationId}`,
    `user:${opts.userId}`,
    ...extraSubjects,
  ];

  const llm = new AnthropicLLMClient({ apiKey: opts.anthropicApiKey });

  const summary = await runHarness(entries, async (entry: EvalEntry) => {
    const result = await runChatAgentLoop({
      llm,
      model: CHAT_MODEL_ID,
      toolCtx: {
        db: opts.db,
        organizationId: opts.organizationId,
        userSubjects,
      },
      initialMessages: [{ role: 'user', content: entry.question }],
      // Tight budgets so a runaway entry doesn't stall the whole batch.
      wallClockMs: 30_000,
      maxToolCalls: 8,
    });
    if (result.kind !== 'answer') {
      // Treat budget exceeded as a hard failure — no answer means
      // every must-substring fails, which is the right signal.
      return { answer: '', citations: [] };
    }
    return {
      answer: result.answer,
      citations: result.citations.map((c) => ({ chunk_id: c.chunk_id })),
    };
  });

  const [row] = await opts.db
    .insert(schema.skillEvalRuns)
    .values({
      organizationId: opts.organizationId,
      skillSlug: opts.skillSlug,
      passRate: summary.passRate,
      total: summary.total,
      passed: summary.passed,
    })
    .returning({
      passRate: schema.skillEvalRuns.passRate,
      total: schema.skillEvalRuns.total,
      passed: schema.skillEvalRuns.passed,
      ranAt: schema.skillEvalRuns.ranAt,
    });

  return {
    total: row!.total,
    passed: row!.passed,
    passRate: row!.passRate,
    ranAt: row!.ranAt.toISOString(),
    perEntry: summary.perEntry.map((r) => ({ entryId: r.entryId, passed: r.passed })),
  };
}
