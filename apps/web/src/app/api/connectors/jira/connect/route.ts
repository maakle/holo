import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  createJiraSpec,
  normalizeJiraSiteUrl,
  fetchJiraServerInfo,
} from '@holo/connectors';
import { createHttpClient, apiKey } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: `${field} is required`,
      fix: `Provide a non-empty ${field} in the request body.`,
    });
  }
  return value.trim();
}

export async function POST(req: Request) {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }

    const body = (await req.json().catch(() => null)) as
      | { siteUrl?: string; email?: string; token?: string }
      | null;
    if (!body) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'request body must be JSON',
        fix: 'POST { siteUrl, email, token } as JSON.',
      });
    }
    const rawSiteUrl = requireString(body.siteUrl, 'siteUrl');
    const email = requireString(body.email, 'email');
    const token = requireString(body.token, 'token');

    // normalizeJiraSiteUrl throws HOLO_INVALID_INPUT when the URL is unparseable
    const siteUrl = normalizeJiraSiteUrl(rawSiteUrl);
    const encoded = Buffer.from(`${email}:${token}`, 'utf-8').toString('base64');

    const authStrategy = apiKey({ prefix: 'Basic ' });
    const probeClient = createHttpClient({
      config: {
        baseUrl: siteUrl,
        retry: { maxAttempts: 3, retryOn: [429, 502, 503, 504] },
      },
      auth: authStrategy,
      tokens: { accessToken: encoded },
    });

    const spec = createJiraSpec();
    try {
      await spec.testConnection({ api: probeClient, tokens: { accessToken: encoded } });
    } catch {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'Jira rejected the credentials',
        fix: 'Check that the email matches the Atlassian account that owns the API token, and that the token is valid (https://id.atlassian.com/manage-profile/security/api-tokens).',
      });
    }

    let serverInfo: { baseUrl?: string; cloudId?: string; serverTitle?: string };
    try {
      serverInfo = await fetchJiraServerInfo(probeClient);
    } catch {
      serverInfo = { baseUrl: siteUrl };
    }

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(
            schema.connectorCredentials.provider,
            'jira' as const,
          ),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({
          accessToken: encoded,
          scope: siteUrl,
          status: 'active',
          lastRefreshedAt: new Date(),
        })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'jira',
        accessToken: encoded,
        scope: siteUrl,
        status: 'active',
      });
    }

    const cloudId = serverInfo.cloudId ?? `jira-${new URL(siteUrl).host}`;
    const workspaceName = serverInfo.serverTitle ?? new URL(siteUrl).host;

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'jira',
        externalId: cloudId,
        name: workspaceName,
        metadata: { siteUrl, cloudId, jira_singleton: true },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: workspaceName,
          metadata: { siteUrl, cloudId, jira_singleton: true },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'jira').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'jira',
      meta: { provider: 'jira', externalId: cloudId, name: workspaceName, siteUrl },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Check server logs.' },
      { status: 500 },
    );
  }
}
