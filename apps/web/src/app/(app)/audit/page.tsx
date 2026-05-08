import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { schema } from '@holo/db';
import { AuditLogTable } from '@/components/audit-log-table';

const PAGE_SIZE = 50;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { auth, db} = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/sign-in');

  const params = await searchParams;
  const pageParam = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [events, [{ total }]] = await Promise.all([
    db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.organizationId, orgId))
      .orderBy(desc(schema.auditEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.organizationId, orgId)),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Audit log</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Security & access events</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Security and data-access events for this organization.
        </p>
      </header>
      <AuditLogTable
        events={events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          userId: e.userId,
          createdAt: e.createdAt.toISOString(),
          meta: (e.meta as Record<string, unknown>) ?? {},
        }))}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
