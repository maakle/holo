import { Module, Logger, OnModuleInit, Injectable } from '@nestjs/common';
import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { holoError, ErrorCode } from '@holo/errors';
import { createDb, schema } from '@holo/db';
import { AnthropicLLMClient } from '@holo/llm';
import { runChatAgentLoop } from '@holo/agent-tools';
import { runHarness, loadEvalEntries, type EvalEntry } from '@holo/skills/server';
import { getSubjectsForUser } from '@holo/user-subjects';
import { QUEUE_NAMES, QUEUE_CONCURRENCY } from './types';

/**
 * Nightly skill-eval cron (RFC-0008).
 *
 * One repeatable job fires every 24h. The processor enumerates every
 * (org_id, skill_slug) tuple that has at least one active eval entry,
 * drives the agent loop per entry, grades with the three deterministic
 * graders, and writes a `skill_eval_runs` roll-up per tuple.
 *
 * Failure mode: a single bad entry should not poison the batch. The
 * harness is per-entry; one OOM or LLM 5xx kills its entry only.
 */

let cachedSql: Sql | null = null;
function getSql(): Sql {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set; cannot run skill-eval cron.',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedSql = postgres(url, { max: 2, onnotice: () => {} });
  return cachedSql;
}

/** Test seam — drop-in `Sql` replacement. */
export function __setSkillEvalSqlForTests(sql: Sql | null): void {
  cachedSql = sql;
}

@Injectable()
class SkillEvalScheduler implements OnModuleInit {
  private readonly logger = new Logger(SkillEvalScheduler.name);
  constructor(@InjectQueue(QUEUE_NAMES.SKILL_EVAL) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    if (process.env.HOLO_SKIP_SKILL_EVAL_CRON === '1') {
      this.logger.log('skill-eval cron skipped (HOLO_SKIP_SKILL_EVAL_CRON=1)');
      return;
    }
    // 24h repeat. Use a stable jobId so a redeploy doesn't pile up duplicates.
    await this.queue.add(
      'nightly',
      {},
      { repeat: { every: 24 * 60 * 60 * 1000 }, jobId: 'skill-eval-nightly' },
    );
    this.logger.log('skill-eval cron scheduled (every 24h)');
  }
}

@Processor(QUEUE_NAMES.SKILL_EVAL, { concurrency: QUEUE_CONCURRENCY['skill-eval'] })
export class SkillEvalProcessor extends WorkerHost {
  private readonly logger = new Logger(SkillEvalProcessor.name);

  async process(_job: Job): Promise<{ ran: number }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not set; skipping skill-eval run.');
      return { ran: 0 };
    }
    const sql = getSql();
    const url = process.env.DATABASE_URL!;
    const db = createDb(url);

    // Enumerate distinct (org_id, skill_slug) tuples with active entries.
    const tuples = await sql<{ organization_id: string; skill_slug: string }[]>`
      SELECT DISTINCT organization_id, skill_slug
        FROM eval_entries
       WHERE status = 'active' AND skill_slug IS NOT NULL
    `;
    if (tuples.length === 0) {
      this.logger.log('no active eval tuples; nothing to do');
      return { ran: 0 };
    }

    let ran = 0;
    for (const tuple of tuples) {
      try {
        // Pick any user in the org for ACL scoping; without one, retrieval
        // would have no subjects to fan out across. Owners are preferred.
        const owners = await sql<{ id: string }[]>`
          SELECT user_id AS id FROM member
           WHERE organization_id = ${tuple.organization_id}
             AND role = 'owner'
           LIMIT 1
        `;
        if (!owners[0]) {
          this.logger.warn(
            `org ${tuple.organization_id} has no owner; skipping skill-eval for ${tuple.skill_slug}`,
          );
          continue;
        }
        const userId = owners[0].id;

        const entries = await loadEvalEntries(db, {
          organizationId: tuple.organization_id,
          skillSlug: tuple.skill_slug,
        });
        if (entries.length === 0) continue;

        const extraSubjects = await getSubjectsForUser(db, userId);
        const userSubjects = [
          `org:${tuple.organization_id}`,
          `user:${userId}`,
          ...extraSubjects,
        ];

        const llm = new AnthropicLLMClient({ apiKey });
        const summary = await runHarness(entries, async (entry: EvalEntry) => {
          const result = await runChatAgentLoop({
            llm,
            model: process.env.HOLO_CHAT_MODEL_ID ?? 'claude-opus-4-7',
            toolCtx: {
              db,
              organizationId: tuple.organization_id,
              userSubjects,
            },
            initialMessages: [{ role: 'user', content: entry.question }],
            wallClockMs: 30_000,
            maxToolCalls: 8,
          });
          if (result.kind !== 'answer') return { answer: '', citations: [] };
          return {
            answer: result.answer,
            citations: result.citations.map((c: { chunk_id: string }) => ({
              chunk_id: c.chunk_id,
            })),
          };
        });

        await db.insert(schema.skillEvalRuns).values({
          organizationId: tuple.organization_id,
          skillSlug: tuple.skill_slug,
          passRate: summary.passRate,
          total: summary.total,
          passed: summary.passed,
        });
        ran += 1;
        this.logger.log(
          `skill-eval ${tuple.skill_slug} org=${tuple.organization_id}: ${summary.passed}/${summary.total}`,
        );
      } catch (err) {
        this.logger.error(
          `skill-eval failed for ${tuple.skill_slug}/${tuple.organization_id}: ${(err as Error).message}`,
        );
      }
    }
    return { ran };
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SKILL_EVAL })],
  providers: [SkillEvalScheduler, SkillEvalProcessor],
  exports: [BullModule],
})
export class SkillEvalModule {}
