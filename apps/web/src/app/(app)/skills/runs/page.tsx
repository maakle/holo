import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { SkillRunsTable } from '@/components/skill-runs-table';

interface StepTrace {
  stepIndex: number;
  stepText: string;
  llmResponse: string;
}

export default async function SkillRunsPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

  const runs = await db
    .select({
      id: schema.skillRuns.id,
      skillId: schema.skillRuns.skillId,
      status: schema.skillRuns.status,
      steps: schema.skillRuns.steps,
      errorMessage: schema.skillRuns.errorMessage,
      startedAt: schema.skillRuns.startedAt,
      completedAt: schema.skillRuns.completedAt,
      skillName: schema.skills.name,
    })
    .from(schema.skillRuns)
    .innerJoin(schema.skills, eq(schema.skillRuns.skillId, schema.skills.id))
    .where(eq(schema.skillRuns.organizationId, orgId))
    .orderBy(desc(schema.skillRuns.startedAt))
    .limit(100);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Skill runs</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Skill execution log</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Last 100 skill executions. Click a row to see the step trace.
        </p>
      </header>
      <SkillRunsTable
        runs={runs.map((r) => ({
          id: r.id,
          skillName: r.skillName,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
          steps: (r.steps as unknown as StepTrace[]) ?? [],
          errorMessage: r.errorMessage,
        }))}
      />
    </div>
  );
}
