CREATE TABLE "answer_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"answer_id" uuid NOT NULL,
	"skill_slug" text,
	"rating" smallint NOT NULL,
	"correction_text" text,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"citations_jsonb" jsonb NOT NULL,
	"coverage_jsonb" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_feedback_id" uuid,
	"skill_slug" text,
	"question" text NOT NULL,
	"expected" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
CREATE TABLE "skill_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"skill_slug" text NOT NULL,
	"pass_rate" double precision NOT NULL,
	"total" integer NOT NULL,
	"passed" integer NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_feedback" ADD CONSTRAINT "answer_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_entries" ADD CONSTRAINT "eval_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_entries" ADD CONSTRAINT "eval_entries_source_feedback_id_answer_feedback_id_fk" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."answer_feedback"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_entries" ADD CONSTRAINT "eval_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_runs" ADD CONSTRAINT "skill_eval_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answer_feedback_org_skill_created_idx" ON "answer_feedback" USING btree ("organization_id","skill_slug","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "answer_feedback_answer_user_uniq" ON "answer_feedback" USING btree ("answer_id","user_id");--> statement-breakpoint
CREATE INDEX "eval_entries_org_skill_status_idx" ON "eval_entries" USING btree ("organization_id","skill_slug","status");--> statement-breakpoint
CREATE INDEX "skill_eval_runs_org_skill_ran_idx" ON "skill_eval_runs" USING btree ("organization_id","skill_slug","ran_at");
