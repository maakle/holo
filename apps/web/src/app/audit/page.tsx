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
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Audit Log</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24, fontSize: 14 }}>
        Last 200 security and data-access events for this organization.
      </p>
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
