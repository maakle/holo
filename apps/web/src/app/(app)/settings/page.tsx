import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { DangerZone } from './danger-zone';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { auth, db, defaultOrgId } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings');

  const orgId = resolveActiveOrgId(session, defaultOrgId);
  if (!orgId) redirect('/dashboard');

  const [org] = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .limit(1);
  if (!org) redirect('/dashboard');

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, orgId),
        eq(schema.member.userId, session.user.id),
      ),
    )
    .limit(1);

  const isOwner = me?.role === 'owner';
  const isDefaultOrg = orgId === defaultOrgId;

  return (
    <div className="max-w-3xl space-y-10">
      <header className="flex flex-col gap-2">
        <span className="caption">Workspace</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Settings</h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Manage your workspace. Destructive actions live in the Danger Zone below.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Workspace details</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Row label="Name" value={org.name} />
          <Row label="Slug" value={org.slug} />
          <Row label="Your role" value={me?.role ?? '—'} />
        </div>
      </section>

      <DangerZone
        organizationId={org.id}
        organizationName={org.name}
        canDelete={isOwner && !isDefaultOrg}
        reason={
          isDefaultOrg
            ? 'The default workspace cannot be deleted.'
            : !isOwner
              ? 'Only owners can delete this workspace.'
              : undefined
        }
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
      <span className="text-[13px] text-text-subtle">{label}</span>
      <span className="text-[13px] text-text">{value}</span>
    </div>
  );
}
