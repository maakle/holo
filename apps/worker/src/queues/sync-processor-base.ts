import { Logger } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import postgres, { type Sql } from 'postgres';
import { eq, and } from 'drizzle-orm';
import { createDb, schema as dbSchema, type DB } from '@holo/db';
import { recordAgentEvent } from '@holo/audit';
import {
  debitConnectorSync,
  checkCreditPool,
  checkStorageQuota,
} from '@holo/billing';
import { sendStorageCapReachedEmail } from '@holo/email';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getWorkerPosthog } from '../posthog';
import { runSyncJob, type SyncResult } from './sync-dispatch';
import { getSyncRunner, awaitRegistrationReady } from './sync-runner-registry';
import {
  createPostgresSyncCursorStore,
  type SyncCursorStore,
} from './sync-cursor-store';
import { createPostgresCheckpointStore, type CheckpointStore } from '../step';
import {
  startSyncRun,
  finishSyncRunOk,
  finishSyncRunFailed,
  updateSyncRunProgress,
} from './sync-runs-store';
import type { QueueName, SyncJobPayload } from './types';

let cachedSql: Sql | null = null;
let cachedDb: DB | null = null;
let cachedCursorStore: SyncCursorStore | null = null;
let cachedCheckpointStore: CheckpointStore | null = null;

function getSql(): Sql {
  if (cachedSql) return cachedSql;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedSql = postgres(url, { max: 4, onnotice: () => {} });
  return cachedSql;
}

function getDb(): DB {
  if (cachedDb) return cachedDb;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'DATABASE_URL is not set',
      fix: 'Export DATABASE_URL before starting the worker process.',
    });
  }
  cachedDb = createDb(url);
  return cachedDb;
}

function providerForQueue(queue: QueueName): string {
  if (queue === 'github-code-sync') return 'github-code';
  if (queue === 'github-prose-sync') return 'github-prose';
  if (queue === 'gitlab-code-sync') return 'gitlab-code';
  if (queue === 'gitlab-prose-sync') return 'gitlab-prose';
  return queue.replace(/-sync$/, '');
}

function getCursorStore(): SyncCursorStore {
  cachedCursorStore ??= createPostgresSyncCursorStore(getSql());
  return cachedCursorStore;
}

function getCheckpointStore(): CheckpointStore {
  cachedCheckpointStore ??= createPostgresCheckpointStore(getSql());
  return cachedCheckpointStore;
}

// Test seam: lets tests swap in in-memory stores.
export function __setStoresForTests(args: {
  cursorStore?: SyncCursorStore;
  checkpointStore?: CheckpointStore;
  db?: DB;
}): void {
  if (args.cursorStore) cachedCursorStore = args.cursorStore;
  if (args.checkpointStore) cachedCheckpointStore = args.checkpointStore;
  if (args.db) cachedDb = args.db;
}

export abstract class SyncProcessorBase extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);
  protected abstract readonly queueName: QueueName;

  async process(job: Job<SyncJobPayload>): Promise<SyncResult> {
    // BullMQ workers start consuming during Nest onModuleInit, but
    // SyncRunnersBootstrap replaces the default stubs with real runners in
    // onApplicationBootstrap. If a job is already in Redis at worker
    // restart, it can land here before registration completes. Wait until
    // bootstrap signals ready before resolving the runner — otherwise we'd
    // dispatch against the stub and surface HOLO_CONNECTOR_NOT_IMPLEMENTED
    // for a connector that's actually wired.
    await awaitRegistrationReady();
    const jobId = job.id ?? `unidentified-${Date.now()}`;
    const ctx = `sourceId=${job.data.sourceId} queue=${this.queueName} jobId=${jobId}`;
    const sql = getSql();
    const startedAtMs = Date.now();
    const provider = providerForQueue(this.queueName);

    // Refuse new sync runs when the org is out of credits. Return early with
    // a `credit_pool_exhausted` skipReason so the dashboard surfaces "paused
    // — buy more credits" rather than "failed". Existing in-flight runs
    // aren't interrupted (BullMQ doesn't preempt running jobs).
    const db = getDb();
    const creditDecision = await checkCreditPool(db, job.data.organizationId);
    if (!creditDecision.allowed) {
      this.logger.log(
        `skipping ${ctx}: org credit pool exhausted (balance=${creditDecision.balance}) — buy a top-up at /settings/billing`,
      );
      getWorkerPosthog().capture({
        distinctId: `org:${job.data.organizationId}`,
        event: 'holo.pool.exhausted',
        groups: { organization: job.data.organizationId },
        properties: { surface: 'sync', queue: this.queueName, balance: creditDecision.balance },
      });
      return { artifactCount: 0, newCursor: null, skipReason: 'credit_pool_exhausted' };
    }

    // Refuse new sync runs when the org is already at its plan's
    // `maxStoredChunks` ceiling. `deltaCount=0` here — we ask "are you
    // already over?", not "can this run fit?" (the run size is unknown until
    // the connector emits chunks). A second, batch-sized check happens in
    // the embed processor so a single fat batch can't push the org past
    // the cap. Pre-cap content remains queryable.
    const storageDecision = await checkStorageQuota(db, job.data.organizationId);
    if (!storageDecision.allowed) {
      this.logger.log(
        `skipping ${ctx}: storage cap reached (${storageDecision.currentCount}/${storageDecision.limit}) — upgrade from ${storageDecision.currentPlanSlug}`,
      );
      getWorkerPosthog().capture({
        distinctId: `org:${job.data.organizationId}`,
        event: 'holo.storage.cap_reached',
        groups: { organization: job.data.organizationId },
        properties: {
          surface: 'sync',
          queue: this.queueName,
          current_plan: storageDecision.currentPlanSlug,
          limit: storageDecision.limit,
          current_count: storageDecision.currentCount,
        },
      });
      // Fire-and-forget the owner notification. Idempotent per billing
      // period so an org sitting over cap for weeks gets one email per
      // period, not one per blocked sync tick. Failures are logged but
      // never fail the sync skip — email is informational, not on the
      // critical path.
      void notifyStorageCapReached(db, this.logger, {
        organizationId: job.data.organizationId,
        currentCount: storageDecision.currentCount,
        limit: storageDecision.limit,
        currentPlanName: storageDecision.currentPlanName,
        suggestedUpgradeSlug: storageDecision.suggestedUpgradeSlug,
      });
      return { artifactCount: 0, newCursor: null, skipReason: 'storage_cap_reached' };
    }
    // Best-effort run-history write. If the insert itself blows up (DB down,
    // FK violation against a deleted source), we'd rather still attempt the
    // sync than refuse to start — the BullMQ history is the fallback.
    try {
      await startSyncRun(sql, {
        queueName: this.queueName,
        jobId,
        payload: job.data,
      });
    } catch (err) {
      // FK violation on source_id means the source was deleted (user
      // disconnected) after this job was enqueued. There's nothing to sync —
      // bail without running the connector, otherwise we'd waste an API
      // round-trip and produce a misleading 'failed' run row. Anything else
      // we just warn about and try to sync anyway.
      const msg = (err as Error).message ?? '';
      const sourceGone = /sync_runs_source_id_fkey/.test(msg);
      if (sourceGone) {
        this.logger.log(
          `skipping ${ctx}: source no longer exists (likely disconnected)`,
        );
        return { artifactCount: 0, newCursor: null, skipReason: 'source_deleted' };
      }
      this.logger.warn(`sync_runs start insert failed ${ctx}: ${msg}`);
    }
    getWorkerPosthog().capture({
      distinctId: `org:${job.data.organizationId}`,
      event: 'sync_job_started',
      groups: { organization: job.data.organizationId },
      properties: {
        provider,
        queue: this.queueName,
        source_id: job.data.sourceId,
      },
    });
    // Debounced heartbeat: connectors call reportProgress freely (once per
    // page / repo / channel), but we coalesce to one DB write every ~1s and
    // skip writes when nothing changed since the last one. Final state on
    // ok/failed comes from finishSyncRun*, not from this path.
    let lastProgressWriteAt = 0;
    let lastProgressKey = '';
    const reportProgress = (input: {
      current: number;
      total?: number | null;
      message?: string;
    }): void => {
      const now = Date.now();
      const key = `${input.current}/${input.total ?? ''}/${input.message ?? ''}`;
      if (key === lastProgressKey) return;
      if (now - lastProgressWriteAt < 1000) return;
      lastProgressKey = key;
      lastProgressWriteAt = now;
      updateSyncRunProgress(sql, {
        queueName: this.queueName,
        jobId,
        current: input.current,
        total: input.total ?? null,
        message: input.message ?? null,
      }).catch((err) => {
        this.logger.warn(
          `sync_runs progress update failed ${ctx}: ${(err as Error).message}`,
        );
      });
    };

    // Cooperative cancellation. The /stop endpoint flips sync_runs.status to
    // 'cancelled' but can't actually interrupt this Node promise — we poll our
    // own row and abort the controller when the user pressed Stop. Connectors
    // that thread the signal through (Slack today; others as they're wired)
    // exit at the next checkpoint instead of running to natural completion.
    const controller = new AbortController();
    const cancelPoll = setInterval(() => {
      sql<{ status: string }[]>`
        SELECT status FROM sync_runs
         WHERE queue_name = ${this.queueName} AND job_id = ${jobId}
         LIMIT 1
      `
        .then((rows) => {
          if (rows[0]?.status === 'cancelled' && !controller.signal.aborted) {
            controller.abort(
              holoError({
                code: ErrorCode.HOLO_SYNC_CANCELLED,
                problem: 'sync was cancelled by user',
                fix: 'Re-run the sync from the connector panel.',
              }),
            );
          }
        })
        .catch(() => {
          // A transient DB blip shouldn't kill the sync — just try again on
          // the next tick.
        });
    }, 1500);

    try {
      const result = await runSyncJob({
        queue: this.queueName,
        jobId,
        payload: job.data,
        runner: getSyncRunner(this.queueName),
        cursorStore: getCursorStore(),
        checkpointStore: getCheckpointStore(),
        reportProgress,
        signal: controller.signal,
      });
      try {
        await finishSyncRunOk(sql, {
          queueName: this.queueName,
          jobId,
          artifactCount: result.artifactCount,
          skipReason: result.skipReason ?? null,
          breakdown: result.breakdown ?? null,
        });
      } catch (err) {
        this.logger.warn(`sync_runs ok update failed ${ctx}: ${(err as Error).message}`);
      }
      // Sync metering: charge the org for newly-indexed artifacts. Idempotent
      // via the `(queueName, jobId)` reference — BullMQ retries that re-enter
      // this success path don't double-debit. No-op when HOLO_BILLING_ENABLED
      // is unset (self-hosted CE installs).
      try {
        await debitConnectorSync({
          db: getDb(),
          organizationId: job.data.organizationId,
          provider,
          artifactCount: result.artifactCount,
          syncRunReference: `${this.queueName}:${jobId}`,
          breakdown: result.breakdown ?? null,
        });
      } catch (err) {
        this.logger.warn(
          `billing debit failed ${ctx}: ${(err as Error).message}`,
        );
      }
      this.logger.log(`synced ${ctx} artifacts=${result.artifactCount}`);
      getWorkerPosthog().capture({
        distinctId: `org:${job.data.organizationId}`,
        event: 'sync_job_succeeded',
        groups: { organization: job.data.organizationId },
        properties: {
          provider,
          queue: this.queueName,
          duration_ms: Date.now() - startedAtMs,
          artifact_count: result.artifactCount,
          skip_reason: result.skipReason ?? null,
        },
      });
      recordAgentEvent(
        {
          db: getDb(),
          organizationId: job.data.organizationId,
          kind: 'connector_sync',
          name: provider,
          agentIdentity: `worker:sync:${provider}`,
          latencyMs: Date.now() - startedAtMs,
          inputJson: {
            sourceId: job.data.sourceId,
            queue: this.queueName,
            jobId,
          },
          outputJson: {
            artifactCount: result.artifactCount,
            skipReason: result.skipReason ?? null,
            breakdown: result.breakdown ?? null,
          },
        },
        (err) =>
          this.logger.warn(
            `agent_event record failed ${ctx}: ${(err as Error).message}`,
          ),
      );
      return result;
    } catch (err) {
      // User-initiated cancellation: the row is already 'cancelled' (set by
      // /stop), and finishSyncRunFailed's `WHERE status='running'` guard will
      // no-op against it. Log calmly and rethrow so BullMQ marks the job
      // failed without retry-spam.
      const cancelled =
        err instanceof HoloError && err.code === ErrorCode.HOLO_SYNC_CANCELLED;
      try {
        await finishSyncRunFailed(sql, {
          queueName: this.queueName,
          jobId,
          error: err,
        });
      } catch (e) {
        this.logger.warn(`sync_runs fail update failed ${ctx}: ${(e as Error).message}`);
      }
      const errorCode =
        err instanceof HoloError
          ? err.code
          : cancelled
            ? ErrorCode.HOLO_SYNC_CANCELLED
            : 'UNKNOWN';
      const errorMessage =
        err instanceof HoloError
          ? err.problem
          : ((err as Error)?.message ?? String(err));
      getWorkerPosthog().capture({
        distinctId: `org:${job.data.organizationId}`,
        event: 'sync_job_failed',
        groups: { organization: job.data.organizationId },
        properties: {
          provider,
          queue: this.queueName,
          duration_ms: Date.now() - startedAtMs,
          error_code: errorCode,
          cancelled,
        },
      });
      recordAgentEvent(
        {
          db: getDb(),
          organizationId: job.data.organizationId,
          kind: 'connector_sync',
          name: provider,
          agentIdentity: `worker:sync:${provider}`,
          latencyMs: Date.now() - startedAtMs,
          errorCode,
          inputJson: {
            sourceId: job.data.sourceId,
            queue: this.queueName,
            jobId,
          },
          outputJson: {
            error: errorMessage,
            cancelled,
          },
        },
        (e) =>
          this.logger.warn(
            `agent_event record failed ${ctx}: ${(e as Error).message}`,
          ),
      );
      if (cancelled) {
        this.logger.log(`cancelled ${ctx}`);
        throw err;
      }
      // Surface failures in the worker terminal with full HoloError context
      // (code + problem + cause + fix). Without this, BullMQ would swallow the
      // detail and the only place to see anything was the sync-history UI,
      // which previously also stripped the cause.
      if (err instanceof HoloError) {
        this.logger.error(
          `failed ${ctx} code=${err.code}\n  problem: ${err.problem}\n  cause:   ${err.cause ?? '<none>'}\n  fix:     ${err.fix}`,
        );
      } else {
        // Unwrap undici-style errors that hide the real cause behind a generic
        // "TypeError: fetch failed" message. The interesting bit is on .cause.
        const e = err as Error & { cause?: unknown; code?: string };
        const cause = e.cause
          ? `\n  cause:   ${(e.cause as Error)?.stack ?? String(e.cause)}`
          : '';
        const code = e.code ? ` errno=${e.code}` : '';
        this.logger.error(`failed ${ctx}${code} ${e.stack ?? String(e)}${cause}`);
      }
      throw err;
    } finally {
      clearInterval(cancelPoll);
    }
  }
}

/**
 * Email the org owner that ingestion has been paused at the storage cap.
 * Idempotency key includes the current period start so a fresh email goes
 * out once per billing cycle if the org is still over cap, but we don't
 * spam them every 4–24 hours when a sync tick re-trips the gate.
 *
 * All failures are logged + swallowed — email is informational, never on
 * the sync critical path.
 */
async function notifyStorageCapReached(
  db: DB,
  logger: Logger,
  args: {
    organizationId: string;
    currentCount: number;
    limit: number;
    currentPlanName: string;
    suggestedUpgradeSlug: string;
  },
): Promise<void> {
  try {
    const { organization, user, member, organizationSubscriptions, billingPlans } = dbSchema;
    // Look up the owner's email + org name + period start. Single round trip
    // (sub-second on warm caches) — if any of these are missing we bail
    // without sending.
    const ownerRows = await db
      .select({
        email: user.email,
        orgName: organization.name,
        periodStart: organizationSubscriptions.currentPeriodStart,
      })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .innerJoin(
        organizationSubscriptions,
        eq(organizationSubscriptions.organizationId, member.organizationId),
      )
      .where(and(eq(member.organizationId, args.organizationId), eq(member.role, 'owner')))
      .orderBy(member.createdAt)
      .limit(1);
    const ownerRow = ownerRows[0];
    if (!ownerRow) return;

    const suggestedUpgradePlan = await db
      .select({ name: billingPlans.name })
      .from(billingPlans)
      .where(eq(billingPlans.slug, args.suggestedUpgradeSlug))
      .limit(1);
    const upgradeName = suggestedUpgradePlan[0]?.name ?? 'a paid plan';

    const base = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '') ?? '';
    const upgradeUrl = `${base}/settings/billing?upgrade=${args.suggestedUpgradeSlug}#plans`;

    await sendStorageCapReachedEmail(db, {
      to: ownerRow.email,
      subject: `Your search index is full — ${ownerRow.orgName} on Holo`,
      organizationId: args.organizationId,
      idempotencyKey: `storage_cap_reached:${args.organizationId}:${ownerRow.periodStart.toISOString()}`,
      metadata: {
        current_count: args.currentCount,
        limit: args.limit,
        current_plan: args.currentPlanName,
        suggested_upgrade: args.suggestedUpgradeSlug,
      },
      template: {
        organizationName: ownerRow.orgName,
        currentPlanName: args.currentPlanName,
        currentCount: args.currentCount,
        limit: args.limit,
        suggestedUpgradePlanName: upgradeName,
        upgradeUrl,
      },
    });
  } catch (err) {
    logger.warn(`storage-cap email failed for org ${args.organizationId}: ${(err as Error).message}`);
  }
}
