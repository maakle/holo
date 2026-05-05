-- Slack event idempotency: dedupe by (team_id, event_id).
-- Slack retries events on non-2xx or timeout for ~1h. The events handler
-- inserts into this table; a unique-key collision means we've already seen
-- the event and should ack 200 without re-enqueuing the worker job.
-- Hand-authored: single new table on the v0.1 Slack-bot branch.

CREATE TABLE "slack_event_dedupe" (
	"team_id" text NOT NULL,
	"event_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "slack_event_dedupe_team_event_uniq" ON "slack_event_dedupe" ("team_id","event_id");
--> statement-breakpoint
CREATE INDEX "slack_event_dedupe_received_at_idx" ON "slack_event_dedupe" ("received_at");
