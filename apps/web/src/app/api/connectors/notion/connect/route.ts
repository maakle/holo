import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { createNotionSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';
import { enforceConnectorLimit } from '@/lib/connector-gate';

export async function POST(req: Request) {
  try {
    const { auth, db} = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }

    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token?.trim()) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'token is required',
        fix: 'Paste your Notion integration token.',
      });
    }
    const token = body.token.trim();

    // Validate the integration token via the framework spec's testConnection.
    const spec = createNotionSpec();
    const tokens = { accessToken: token };
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    // Plan-limit gate: blocks the upsell trigger for free-tier orgs trying
    // to add a 2nd connector. No-op for re-auth of an existing provider.
    await enforceConnectorLimit(db, orgId, 'notion');

    // Upsert connector_credentials
    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'notion'),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({ accessToken: token, status: 'active', lastRefreshedAt: new Date() })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'notion',
        accessToken: token,
        status: 'active',
      });
    }

    // Upsert sources
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'notion',
        externalId: ident.externalId,
        name: ident.name,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [schema.sources.organizationId, schema.sources.provider, schema.sources.externalId],
        set: { name: ident.name, updatedAt: new Date() },
      });

    // Notion's own "Access to content" UI is the access boundary — the
    // integration token can only see pages the user explicitly shared with
    // it. Mirror that on our side with a wildcard allowlist on first connect
    // so users don't have to reselect pages here. Operators can still narrow
    // later via `holo allowlist add notion <pattern>`.
    const existingAllow = await db
      .select({ id: schema.connectorAllowlists.id })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'notion'),
          eq(schema.connectorAllowlists.decision, 'include'),
        ),
      )
      .limit(1);
    if (!existingAllow[0]) {
      await db.insert(schema.connectorAllowlists).values({
        organizationId: orgId,
        provider: 'notion',
        pattern: '*',
        patternKind: 'glob',
        decision: 'include',
        createdBy: userId,
        notes: 'Access is managed inside Notion via page sharing.',
      });
    }

    await enqueueInitialSync(db, orgId, 'notion').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'notion',
      meta: { provider: 'notion', externalId: ident.externalId, name: ident.name },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_NOTION_TOKEN_INVALID' || e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
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
