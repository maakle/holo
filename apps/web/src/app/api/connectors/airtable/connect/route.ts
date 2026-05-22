import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { createAirtableSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enforceConnectorLimit } from '@/lib/connector-gate';
import { enqueueInitialSync } from '@/lib/sync-queue';

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

    const body = (await req.json().catch(() => null)) as { token?: string } | null;
    if (!body?.token?.trim()) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'token is required',
        fix: 'Paste your Airtable personal access token.',
      });
    }
    const token = body.token.trim();

    // Validate the PAT via the framework spec's testConnection.
    const spec = createAirtableSpec();
    const tokens = { accessToken: token };
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

    const orgId = resolveActiveOrgId(session);

    // Plan-limit gate (free → 2 connectors). No-op for re-auth and for self-hosted CE.
    await enforceConnectorLimit(db, orgId, 'airtable');
    const userId = session.user.id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'airtable'),
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
        provider: 'airtable',
        accessToken: token,
        status: 'active',
      });
    }

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'airtable',
        externalId: ident.externalId,
        name: ident.name,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [schema.sources.organizationId, schema.sources.provider, schema.sources.externalId],
        set: { name: ident.name, updatedAt: new Date() },
      });

    // Airtable's PAT scope (which bases the token can read) is the access
    // boundary on Airtable's side. Mirror that with a `*` glob on first
    // connect — operators can later narrow via
    // `holo allowlist add airtable <baseId>`.
    const existingAllow = await db
      .select({ id: schema.connectorAllowlists.id })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'airtable'),
          eq(schema.connectorAllowlists.decision, 'include'),
        ),
      )
      .limit(1);
    if (!existingAllow[0]) {
      await db.insert(schema.connectorAllowlists).values({
        organizationId: orgId,
        provider: 'airtable',
        pattern: '*',
        patternKind: 'glob',
        decision: 'include',
        createdBy: userId,
        notes: 'Access is managed inside Airtable via the PAT base list.',
      });
    }

    await enqueueInitialSync(db, orgId, 'airtable').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'airtable',
      meta: { provider: 'airtable', externalId: ident.externalId, name: ident.name },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_AIRTABLE_TOKEN_INVALID' ||
              e.code === 'HOLO_ENV_INVALID' ||
              e.code === 'HOLO_INVALID_INPUT'
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
