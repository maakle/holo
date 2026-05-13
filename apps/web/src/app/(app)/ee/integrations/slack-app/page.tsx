/**
 * EE: bring-your-own Slack app settings. This page is EE — see
 * LICENSING.md. It is rendered only when HOLO_EE_LICENSE_KEY is set; the
 * shared connection flow continues to use the env-configured Holo Slack
 * app for non-EE deployments and for orgs that don't register one here.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled } from '@/lib/ee/license';
import { SlackAppConfigForm } from './slack-app-form';

export const dynamic = 'force-dynamic';

export default async function CustomSlackAppPage() {
  if (!isEnterpriseEnabled()) {
    // CE deployments don't ship this surface at all — surface a 404 rather
    // than a teaser page, matching the rest of the EE-gated routes.
    notFound();
  }

  const { auth, db, env } = await getServerContext();
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  if (!session) redirect('/sign-in?callbackURL=/ee/integrations/slack-app');

  const orgId = resolveActiveOrgId(session);
  const userId = session.user.id;

  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  const isOwner = me?.role === 'owner';

  const [existing] = await db
    .select({
      id: schema.slackAppConfigs.id,
      appId: schema.slackAppConfigs.appId,
      clientId: schema.slackAppConfigs.clientId,
      displayName: schema.slackAppConfigs.displayName,
      updatedAt: schema.slackAppConfigs.updatedAt,
    })
    .from(schema.slackAppConfigs)
    .where(eq(schema.slackAppConfigs.organizationId, orgId))
    .limit(1);

  const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
  const mcpOrigin = (env.MCP_PUBLIC_URL ?? '').replace(/\/+$/, '');
  const oauthRedirectUrl = `${publicOrigin}/api/connectors/slack/callback`;
  const eventsRequestUrl = mcpOrigin ? `${mcpOrigin}/slack/events/${orgId}` : null;
  const slashCommandsUrl = mcpOrigin ? `${mcpOrigin}/slack/commands/${orgId}` : null;

  return (
    <div className="max-w-3xl space-y-10">
      <header className="flex flex-col gap-2">
        <span className="caption">Enterprise · Integrations</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Custom Slack app
        </h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Bring your own Slack app so the bot uses your name, icon, and scopes
          instead of Holo&apos;s. One app per workspace; all Slack workspaces
          you connect under this organization share it.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">1. Create the Slack app</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          In{' '}
          <a
            className="text-accent hover:underline"
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noreferrer"
          >
            api.slack.com/apps
          </a>{' '}
          create a new app from manifest, then paste in the URLs below as the
          OAuth redirect, Event Subscriptions Request URL, and slash-command
          Request URL. Each URL is org-scoped so Slack delivers events to the
          right tenant.
        </p>
        <div className="overflow-hidden rounded-lg border border-border">
          <UrlRow label="OAuth redirect URL" value={oauthRedirectUrl} />
          <UrlRow label="Events Request URL" value={eventsRequestUrl} />
          <UrlRow label="Slash commands URL" value={slashCommandsUrl} />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">2. Paste credentials</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          Copy{' '}
          <span className="font-mono text-text">Client ID</span>,{' '}
          <span className="font-mono text-text">Client Secret</span>, and{' '}
          <span className="font-mono text-text">Signing Secret</span> from
          your Slack app&apos;s{' '}
          <span className="font-mono text-text">Basic Information</span> page.
          Secrets are encrypted at rest and never returned by the API.
        </p>
        <SlackAppConfigForm
          existing={existing ?? null}
          canEdit={isOwner}
          ownerReason={
            isOwner ? null : 'Only workspace owners can manage the custom Slack app.'
          }
        />
      </section>
    </div>
  );
}

function UrlRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-text-subtle">{label}</span>
      <span className="truncate font-mono text-[13px] text-text">
        {value ?? '— set MCP_PUBLIC_URL to surface this URL —'}
      </span>
    </div>
  );
}
