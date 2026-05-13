-- RFC-0005: self-serve skills (fork / promote / archive lifecycle).
--
--  * parent_skill_id  - null = original; non-null = fork. Self-FK, ON DELETE SET NULL
--                       so deleting an original doesn't cascade away its forks
--                       (forks have already diverged and are owned by the org).
--  * updated_by       - last editor; separate from created_by which is set once.
--  * archived_at      - soft-archive timestamp. Status column already encodes
--                       'archived', but we want the precise moment for audit.
--  * skills_org_parent_idx - fast "show me forks of skill X" queries on the
--                       detail page; (organization_id, parent_skill_id).
ALTER TABLE "skills" ADD COLUMN "parent_skill_id" uuid;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_parent_skill_id_skills_id_fk" FOREIGN KEY ("parent_skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skills_org_parent_idx" ON "skills" USING btree ("organization_id","parent_skill_id");
