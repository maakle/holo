-- TTHW (time-to-hello-world) telemetry sink. One row per install ID, written
-- by the gateway on the first successful MCP `search` call when telemetry is
-- opted in. The unique install_id PK is the "fire once" gate.
CREATE TABLE "tthw_reports" (
	"install_id" text PRIMARY KEY NOT NULL,
	"started_at_ms" bigint NOT NULL,
	"finished_at_ms" bigint NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report_status" text DEFAULT 'pending' NOT NULL
);
