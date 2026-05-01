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
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Skill Runs</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>
        Last 100 skill executions. Click a row to see the step trace.
      </p>
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
