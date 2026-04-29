import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@memex/db';
import { memexError, ErrorCode, MemexError } from '@memex/errors';
import { shared, createGithubConnector } from '@memex/connectors';
import { getServerContext } from '@/lib/server-context';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');
    if (errParam) {
      throw memexError({
        code: ErrorCode.MEMEX_OAUTH_EXCHANGE_FAILED,
        problem: `GitHub returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw memexError({
        code: ErrorCode.MEMEX_OAUTH_EXCHANGE_FAILED,
        problem: 'GitHub callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const cookieStore = await cookies();
    const csrfFromCookie = cookieStore.get(shared.CSRF_COOKIE_NAME)?.value;
    if (!csrfFromCookie || csrfFromCookie !== claims.csrf_nonce) {
      throw memexError({
        code: ErrorCode.MEMEX_OAUTH_EXCHANGE_FAILED,
        problem: 'CSRF nonce mismatch on GitHub callback',
        fix: 'Restart the connect flow. Do not share callback URLs.',
      });
    }
    cookieStore.delete(shared.CSRF_COOKIE_NAME);

    const redirectUri = `${env.BETTER_AUTH_URL}/api/connectors/github/callback`;
    const conn = createGithubConnector({
      clientId: env.GITHUB_CONNECTOR_CLIENT_ID,
      clientSecret: env.GITHUB_CONNECTOR_CLIENT_SECRET,
    });
    const tokens = await conn.exchangeCode({ code, redirectUri });
    const ident = await conn.testConnection(tokens);

    const orgId = claims.organization_id;
    const userId = claims.user_id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(schema.connectorCredentials.provider, 'github'),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken ?? null,
          scope: tokens.scope ?? null,
          status: 'active',
          lastRefreshedAt: new Date(),
        })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'github',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        scope: tokens.scope ?? null,
        status: 'active',
      });
    }

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'github',
        externalId: ident.externalId,
        name: ident.name,
        metadata: { login: ident.name },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: { name: ident.name, updatedAt: new Date() },
      });

    return NextResponse.redirect(new URL('/connections', req.url));
  } catch (e) {
    if (e instanceof MemexError) {
      const u = new URL('/connections', req.url);
      u.searchParams.set('connect_error', e.code);
      u.searchParams.set('connect_fix', e.fix);
      return NextResponse.redirect(u);
    }
    console.error(e);
    return NextResponse.redirect(new URL('/connections?connect_error=MEMEX_INTERNAL', req.url));
  }
}
