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
import { buildSlackManifest } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled } from '@/lib/ee/license';
import { SlackAppEditor } from './slack-app-editor';
import { DISPLAY_NAME_PLACEHOLDER } from './constants';

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

  // The manifest needs both gateway URLs. If MCP_PUBLIC_URL is unset we can't
  // build a working manifest — fall back to showing the raw URLs and an
  // operator-facing note instead of a half-manifest. Render with a placeholder
  // so the editor can substitute the live display name client-side without
  // re-importing the connectors package into the browser bundle.
  const manifestTemplate =
    eventsRequestUrl && slashCommandsUrl
      ? buildSlackManifest({
          displayName: DISPLAY_NAME_PLACEHOLDER,
          oauthRedirectUrl,
          eventsRequestUrl,
          slashCommandsUrl,
        })
      : null;

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

      <SlackAppEditor
        existing={existing ?? null}
        canEdit={isOwner}
        ownerReason={
          isOwner ? null : 'Only workspace owners can manage the custom Slack app.'
        }
        manifestTemplate={manifestTemplate}
        oauthRedirectUrl={oauthRedirectUrl}
        eventsRequestUrl={eventsRequestUrl}
        slashCommandsUrl={slashCommandsUrl}
      />
    </div>
  );
}
