import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { AuditLogTable } from '@/components/audit-log-table';

export default async function AuditPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) redirect('/sign-in');

  const events = await db
    .select()
    .from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, orgId))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(200);

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Audit log</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Security & access events</h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Last 200 security and data-access events for this organization.
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
      />
    </div>
  );
}
