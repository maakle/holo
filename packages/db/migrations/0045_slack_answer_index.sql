-- RFC-0008 (slack extension): index slack bot replies by message ts so a
-- reaction_added event later can locate the corresponding `answer_id` and
-- the denormalized question/answer needed by `answer_feedback`.
--
-- One row per bot reply. We don't TTL this table because feedback can land
-- arbitrarily late (a user adds 👍 days after the answer); the row stays
-- as long as we want feedback to remain attributable.
CREATE TABLE "slack_answer_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"slack_team_id" text NOT NULL,
	"slack_channel" text NOT NULL,
	"slack_ts" text NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sources_jsonb" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slack_answer_index" ADD CONSTRAINT "slack_answer_index_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slack_answer_index_answer_id_uniq" ON "slack_answer_index" USING btree ("answer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_answer_index_team_channel_ts_uniq" ON "slack_answer_index" USING btree ("slack_team_id","slack_channel","slack_ts");
