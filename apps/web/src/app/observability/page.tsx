import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { InvocationTable } from '@/components/invocation-table';

export default async function ObservabilityPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const invocations = await db
    .select({
      id: schema.mcpInvocations.id,
      createdAt: schema.mcpInvocations.createdAt,
      agentIdentity: schema.mcpInvocations.agentIdentity,
      toolName: schema.mcpInvocations.toolName,
      latencyMs: schema.mcpInvocations.latencyMs,
      errorCode: schema.mcpInvocations.errorCode,
      inputJson: schema.mcpInvocations.inputJson,
      outputJson: schema.mcpInvocations.outputJson,
    })
    .from(schema.mcpInvocations)
    .where(eq(schema.mcpInvocations.organizationId, orgId))
    .orderBy(desc(schema.mcpInvocations.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Observability</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Last 100 MCP tool invocations from your connected agents.
        </p>
      </div>

      <InvocationTable invocations={invocations} />
    </div>
  );
}
