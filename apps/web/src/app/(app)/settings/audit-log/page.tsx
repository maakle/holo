import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled } from '@/lib/ee/license';
import { schema } from '@holo/db';
import { AuditLogTable } from '@/components/ee/audit-log-table';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function SettingsAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  if (!isEnterpriseEnabled()) {
    notFound();
  }

  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/audit-log');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/sign-in');

  const params = await searchParams;
  const pageParam = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [events, totalRows] = await Promise.all([
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

  const total = totalRows[0]?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h2 className="text-[15px] font-medium">Security &amp; access events</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          Security and data-access events for this workspace.
        </p>
      </section>
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
