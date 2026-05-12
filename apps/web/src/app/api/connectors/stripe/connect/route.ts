import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { createStripeSpec } from '@holo/connectors';
import { createHttpClient } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
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
        fix: 'Paste your Stripe restricted key (rk_…) or secret key (sk_…).',
      });
    }
    const token = body.token.trim();

    // Shape check — surface a friendly error before we hit Stripe with a
    // plainly bogus token. Stripe keys start with sk_ (secret) or rk_
    // (restricted); test-mode variants embed `_test_`.
    if (!/^(sk|rk)_(test|live)_/.test(token)) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'token does not look like a Stripe API key',
        fix: 'Stripe keys start with sk_test_/sk_live_ or rk_test_/rk_live_. Paste the value from the Stripe dashboard.',
      });
    }

    // Validate against Stripe via /v1/account.
    const spec = createStripeSpec();
    const tokens = { accessToken: token };
    const api = createHttpClient({ config: spec.http!, auth: spec.auth, tokens });
    const ident = await spec.testConnection({ api, tokens });

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'stripe'),
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
        provider: 'stripe',
        accessToken: token,
        status: 'active',
      });
    }

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'stripe',
        externalId: ident.externalId,
        name: ident.name,
        metadata: {},
      })
      .onConflictDoUpdate({
        target: [schema.sources.organizationId, schema.sources.provider, schema.sources.externalId],
        set: { name: ident.name, updatedAt: new Date() },
      });

    await enqueueInitialSync(db, orgId, 'stripe').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'stripe',
      meta: { provider: 'stripe', externalId: ident.externalId, name: ident.name },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_OAUTH_EXCHANGE_FAILED' ||
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
