import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { createNotionConnector } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
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

    // Validate token via testConnection
    const connector = createNotionConnector();
    const ident = await connector.testConnection({ accessToken: token });

    const orgId = defaultOrgId;
    const userId = session.user.id;

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

    await enqueueInitialSync(db, orgId, 'notion').catch(() => {});

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
