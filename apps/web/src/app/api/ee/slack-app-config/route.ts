/**
 * EE API: GET / PUT / DELETE the active organization's custom Slack app
 * credentials (the "bring your own Slack bot" feature). This file is EE
 * — see LICENSING.md.
 *
 * Only owners can read or mutate the row. The GET response never returns
 * client_secret or signing_secret — those are write-only from the UI's
 * perspective so an attacker who steals a session can't exfiltrate them.
 * PUT is upsert (one row per org, enforced by slack_app_configs_org_uniq).
 * DELETE removes the custom app and forces the org back to the shared
 * Holo app — but only when no Slack credentials still reference it, to
 * avoid orphaning live bot installs that would stop verifying webhooks.
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { isEnterpriseEnabled, EE_DISABLED_REASON } from '@/lib/ee/license';

async function requireOwner(): Promise<{ orgId: string; userId: string }> {
  if (!isEnterpriseEnabled()) {
    throw holoError({
      code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
      problem: 'Custom Slack app is an Enterprise Edition feature',
      fix: EE_DISABLED_REASON,
    });
  }
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'must be signed in',
      fix: 'Sign in first.',
    });
  }
  const orgId = resolveActiveOrgId(session);
  const userId = session.user.id;
  const [me] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!me || me.role !== 'owner') {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'only workspace owners can manage the custom Slack app',
      fix: 'Ask an owner to configure this, or have them transfer ownership.',
    });
  }
  return { orgId, userId };
}

function errorResponse(e: unknown): Response {
  if (e instanceof HoloError) {
    const status =
      e.code === 'HOLO_AUTH_NO_SESSION'
        ? 401
        : e.code === 'HOLO_CONNECTOR_NOT_IMPLEMENTED'
          ? 501
          : e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : 400;
    return NextResponse.json(e.toJSON(), { status });
  }
  console.error(e);
  return NextResponse.json(
    { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'check server logs' },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const { orgId } = await requireOwner();
    const { db, env } = await getServerContext();
    const rows = await db
      .select({
        id: schema.slackAppConfigs.id,
        appId: schema.slackAppConfigs.appId,
        clientId: schema.slackAppConfigs.clientId,
        displayName: schema.slackAppConfigs.displayName,
        createdAt: schema.slackAppConfigs.createdAt,
        updatedAt: schema.slackAppConfigs.updatedAt,
      })
      .from(schema.slackAppConfigs)
      .where(eq(schema.slackAppConfigs.organizationId, orgId))
      .limit(1);
    const row = rows[0] ?? null;

    // URLs the customer pastes into api.slack.com → App Manifest. These are
    // org-scoped on purpose: per-org event/redirect URLs let each customer
    // own their Slack app's manifest end-to-end without coordinating with
    // us. Surfaced in both GET and as a "Setup" hint in the UI.
    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const mcpOrigin = (env.MCP_PUBLIC_URL ?? '').replace(/\/+$/, '');
    return NextResponse.json({
      configured: row !== null,
      config: row,
      manifestUrls: {
        oauthRedirectUrl: `${publicOrigin}/api/connectors/slack/callback`,
        // Per-org event + commands URLs live on the gateway so signature
        // verification can use the org's per-app signing secret.
        eventsRequestUrl: mcpOrigin ? `${mcpOrigin}/slack/events/${orgId}` : null,
        slashCommandsUrl: mcpOrigin ? `${mcpOrigin}/slack/commands/${orgId}` : null,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

const upsertSchema = z.object({
  clientId: z.string().min(1, 'client_id is required').max(200),
  clientSecret: z.string().min(1, 'client_secret is required').max(400),
  signingSecret: z.string().min(1, 'signing_secret is required').max(400),
  appId: z.string().max(50).optional().nullable(),
  displayName: z.string().max(100).optional().nullable(),
});

export async function PUT(req: Request) {
  try {
    const { orgId, userId } = await requireOwner();
    const { db } = await getServerContext();
    const body = (await req.json()) as unknown;
    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: parsed.error.issues[0]?.message ?? 'invalid input',
        fix: 'Verify the form fields match the schema.',
      });
    }
    const { clientId, clientSecret, signingSecret, appId, displayName } = parsed.data;

    await db
      .insert(schema.slackAppConfigs)
      .values({
        organizationId: orgId,
        appId: appId ?? null,
        clientId,
        clientSecret,
        signingSecret,
        displayName: displayName ?? null,
        createdByUserId: userId,
      })
      .onConflictDoUpdate({
        target: schema.slackAppConfigs.organizationId,
        set: {
          appId: appId ?? null,
          clientId,
          clientSecret,
          signingSecret,
          displayName: displayName ?? null,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE() {
  try {
    const { orgId } = await requireOwner();
    const { db } = await getServerContext();

    // Refuse to delete while any active Slack credentials still point at
    // this app — deleting the row would leave webhook signature checks
    // failing closed on every inbound event with no way for the customer
    // to recover other than disconnect-and-reinstall. Force the
    // disconnect first.
    const [stillInUse] = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .innerJoin(
        schema.slackAppConfigs,
        eq(schema.slackAppConfigs.id, schema.connectorCredentials.slackAppConfigId),
      )
      .where(
        and(
          eq(schema.slackAppConfigs.organizationId, orgId),
          eq(schema.connectorCredentials.status, 'active'),
        ),
      )
      .limit(1);
    if (stillInUse) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'Slack workspaces are still installed under this custom app',
        fix: 'Disconnect Slack from the Connections page first, then remove the custom app.',
      });
    }

    await db
      .delete(schema.slackAppConfigs)
      .where(eq(schema.slackAppConfigs.organizationId, orgId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
