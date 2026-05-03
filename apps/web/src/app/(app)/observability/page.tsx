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

  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

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
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Observability</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Agent invocations</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Last 100 MCP tool invocations from your connected agents. Click a row to preview
          input and output, or open the full replay for a shareable, deep-linkable view.
        </p>
      </header>

      <InvocationTable invocations={invocations} />
    </div>
  );
}
