import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { schema, agentEventKind, type AgentEventKind } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ObservabilityView, type EventRow } from '@/components/observability';

const PAGE_SIZE = 200;

interface SearchParams {
  kind?: string;
  status?: string;
  tool?: string;
  q?: string;
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

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/sign-in');

  const params = await searchParams;
  const kindFilter = isAgentEventKind(params.kind) ? params.kind : undefined;
  const statusFilter = params.status === 'error' ? 'error' : undefined;
  const toolFilter =
    typeof params.tool === 'string' && params.tool.trim().length > 0
      ? params.tool.trim()
      : undefined;
  const cursor = params.cursor ? new Date(params.cursor) : undefined;
  const query = typeof params.q === 'string' ? params.q.trim() : '';

  const conditions = [eq(schema.mcpInvocations.organizationId, orgId)];
  if (kindFilter) conditions.push(eq(schema.mcpInvocations.kind, kindFilter));
  if (statusFilter === 'error') conditions.push(isNotNull(schema.mcpInvocations.errorCode));
  if (toolFilter) conditions.push(eq(schema.mcpInvocations.toolName, toolFilter));
  if (cursor) conditions.push(lt(schema.mcpInvocations.createdAt, cursor));
  if (query) {
    conditions.push(
      sql`(${schema.mcpInvocations.toolName} ilike ${'%' + query + '%'}
        or ${schema.mcpInvocations.agentIdentity} ilike ${'%' + query + '%'}
        or ${schema.mcpInvocations.traceId}::text ilike ${'%' + query + '%'})`,
    );
  }

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
    createdAt: r.createdAt.toISOString(),
  }));
  const nextCursor = hasMore ? events[events.length - 1]!.createdAt : null;

  const statsRow = await db
    .select({
      total: sql<number>`count(*)::int`.as('total'),
      errors:
        sql<number>`sum(case when ${schema.mcpInvocations.errorCode} is not null then 1 else 0 end)::int`.as(
          'errors',
        ),
    })
    .from(schema.mcpInvocations)
    .where(and(eq(schema.mcpInvocations.organizationId, orgId)))
    .then((r) => r[0]);

  const replayRow = await db
    .select({
      replays: sql<number>`count(*)::int`.as('replays'),
      replayViewers: sql<number>`count(distinct ${schema.replayViews.userId})::int`.as(
        'replay_viewers',
      ),
    })
    .from(schema.replayViews)
    .where(eq(schema.replayViews.organizationId, orgId))
    .then((r) => r[0]);

  const stats = {
    total: statsRow?.total ?? 0,
    errors: statsRow?.errors ?? 0,
    replays: replayRow?.replays ?? 0,
    replayViewers: replayRow?.replayViewers ?? 0,
  };

  // Distinct tool names + counts for `kind = 'tool'` rows in this org.
  // Powers the Tool sub-filter in the rail. Cheap aggregate, ordered by
  // descending count so the most-used tools surface first.
  const toolRows = await db
    .select({
      name: schema.mcpInvocations.toolName,
      count: sql<number>`count(*)::int`.as('count'),
    })
    .from(schema.mcpInvocations)
    .where(
      and(
        eq(schema.mcpInvocations.organizationId, orgId),
        eq(schema.mcpInvocations.kind, 'tool_call'),
        isNotNull(schema.mcpInvocations.toolName),
      ),
    )
    .groupBy(schema.mcpInvocations.toolName)
    .orderBy(desc(sql`count(*)`));
  const availableTools = toolRows
    .filter((r): r is { name: string; count: number } => r.name !== null)
    .map((r) => ({ name: r.name, count: r.count }));

  return (
    <ObservabilityView
      events={events}
      nextCursor={nextCursor}
      kind={kindFilter}
      status={statusFilter}
      tool={toolFilter}
      query={query}
      availableKinds={agentEventKind}
      availableTools={availableTools}
      stats={stats}
    />
  );
}

function isAgentEventKind(v: string | undefined): v is AgentEventKind {
  return !!v && (agentEventKind as readonly string[]).includes(v);
}
