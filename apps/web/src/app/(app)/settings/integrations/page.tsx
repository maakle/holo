import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled } from '@/lib/ee/license';

export const dynamic = 'force-dynamic';

export default async function SettingsIntegrationsPage() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/integrations');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

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
  const eeEnabled = isEnterpriseEnabled();

  if (!eeEnabled || !isOwner) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-6 text-[13px] text-text-muted">
        {eeEnabled
          ? 'Only workspace owners can manage customization.'
          : 'Customization is an Enterprise feature.'}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium">
        Customization <span className="caption ml-2">Enterprise</span>
      </h2>
      <a
        href="/ee/integrations/slack-app"
        className="block rounded-lg border border-border px-4 py-3 hover:border-border-strong"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium">Custom Slack app</div>
            <div className="text-[12px] text-text-subtle">
              Bring your own Slack app — control bot name, icon, scopes.
            </div>
          </div>
          <span className="text-[13px] text-text-subtle">→</span>
        </div>
      </a>
    </section>
  );
}
