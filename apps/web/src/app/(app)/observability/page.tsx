import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { schema, agentEventKind, type AgentEventKind } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { InvocationTable, type EventRow } from '@/components/invocation-table';
import { ObservabilityFilters } from '@/components/observability-filters';

const PAGE_SIZE = 200;

interface SearchParams {
  kind?: string;
  status?: string;
  cursor?: string;
}

export default async function ObservabilityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

  const params = await searchParams;
  const kindFilter = isAgentEventKind(params.kind) ? params.kind : undefined;
  const statusFilter = params.status === 'error' ? 'error' : undefined;
  const cursor = params.cursor ? new Date(params.cursor) : undefined;

  const conditions = [eq(schema.mcpInvocations.organizationId, orgId)];
  if (kindFilter) conditions.push(eq(schema.mcpInvocations.kind, kindFilter));
  if (statusFilter === 'error') conditions.push(isNotNull(schema.mcpInvocations.errorCode));
  if (cursor) conditions.push(lt(schema.mcpInvocations.createdAt, cursor));

  const rows = await db
    .select({
      id: schema.mcpInvocations.id,
      createdAt: schema.mcpInvocations.createdAt,
      kind: schema.mcpInvocations.kind,
      traceId: schema.mcpInvocations.traceId,
      agentIdentity: schema.mcpInvocations.agentIdentity,
      toolName: schema.mcpInvocations.toolName,
      latencyMs: schema.mcpInvocations.latencyMs,
      errorCode: schema.mcpInvocations.errorCode,
      inputJson: schema.mcpInvocations.inputJson,
      outputJson: schema.mcpInvocations.outputJson,
      metadata: schema.mcpInvocations.metadata,
    })
    .from(schema.mcpInvocations)
    .where(and(...conditions))
    .orderBy(desc(schema.mcpInvocations.createdAt))
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const events: EventRow[] = rows.slice(0, PAGE_SIZE).map((r) => ({
    ...r,
    kind: r.kind as AgentEventKind,
  }));
  const nextCursor = hasMore ? events[events.length - 1]!.createdAt.toISOString() : null;

  // Aggregate stats for the current page (cheap; one extra query keyed by org).
  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`.as('total'),
      errors: sql<number>`sum(case when ${schema.mcpInvocations.errorCode} is not null then 1 else 0 end)::int`.as('errors'),
    })
    .from(schema.mcpInvocations)
    .where(and(eq(schema.mcpInvocations.organizationId, orgId)));

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Observability</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Agent activity</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Every MCP tool call, LLM request, Slack message, and agent step from your
          organization. Events that share a trace are collapsed into one expandable row.
        </p>
        {stats ? (
          <p className="text-[13px] text-text-muted">
            {stats.total.toLocaleString()} events recorded · {stats.errors.toLocaleString()} errors
          </p>
        ) : null}
      </header>

      <ObservabilityFilters
        kind={kindFilter}
        status={statusFilter}
        availableKinds={agentEventKind}
      />

      <InvocationTable events={events} nextCursor={nextCursor} />
    </div>
  );
}

function isAgentEventKind(v: string | undefined): v is AgentEventKind {
  return !!v && (agentEventKind as readonly string[]).includes(v);
}
