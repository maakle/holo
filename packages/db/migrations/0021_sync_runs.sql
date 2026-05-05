-- Durable history of connector sync attempts.
--
-- Until now, run history lived only in BullMQ's `:completed` and `:failed`
-- Redis sets. Wiping the queue (dev resets, eviction, retention trim) erased
-- the user-facing history. This table mirrors every attempt as a row that
-- survives Redis flushes, supports historical queries, and gives us a single
-- shape across every connector (slack, notion, github code+prose, grain,
-- pylon, hubspot, …).
--
-- The worker writes a 'running' row when SyncProcessorBase.process() starts,
-- updates it to 'ok' or 'failed' when the job ends. Stalled jobs (BullMQ
-- timeout, worker crash) leave 'running' rows behind; a boot-time sweep
-- reconciles them to 'stalled'.

CREATE TABLE IF NOT EXISTS "sync_runs" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"  uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "source_id"        uuid        NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "provider"         text        NOT NULL,
  "queue_name"       text        NOT NULL,
  "job_id"           text        NOT NULL,
  "status"           text        NOT NULL,
  "started_at"       timestamptz NOT NULL DEFAULT now(),
  "finished_at"      timestamptz,
  "duration_ms"      integer,
  "artifact_count"   integer,
  "error_code"       text,
  "error_problem"    text,
  "error_cause"      text
);
--> statement-breakpoint

-- One row per (queue, job) attempt. The same job_id can re-appear if BullMQ
-- retries it; we still want one row per attempt, so we include attempts via
-- a numeric suffix on the application side rather than uniquing on job_id.
CREATE UNIQUE INDEX IF NOT EXISTS "sync_runs_queue_job_uniq"
  ON "sync_runs" ("queue_name", "job_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_runs_org_provider_started_idx"
  ON "sync_runs" ("organization_id", "provider", "started_at" DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "sync_runs_source_started_idx"
  ON "sync_runs" ("source_id", "started_at" DESC);
--> statement-breakpoint

-- Used by the boot-time reconciliation sweep to find orphaned 'running' rows.
CREATE INDEX IF NOT EXISTS "sync_runs_status_started_idx"
  ON "sync_runs" ("status", "started_at");
