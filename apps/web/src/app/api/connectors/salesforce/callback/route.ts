import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { shared, createSalesforceSpec } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';

const PENDING_GRANT_TTL_MS = 2 * 60 * 1000;

/**
 * Salesforce OAuth callback. Mirrors the GitLab callback shape: exchange the
 * code on this (WEB_PUBLIC_URL) origin, stash the encrypted tokens + the
 * per-org instance_url + identity URL into a single-use `oauth_pending_grants`
 * row, then redirect to /finalize on BETTER_AUTH_URL where the better-auth
 * session is checkable. The session-bind check there is the defense against
 * confused-deputy replays of the state JWT.
 *
 * Salesforce-specific bits the generic OAuth flow doesn't capture:
 *  - `instance_url` — per-org REST API host (e.g. https://acme.my.salesforce.com).
 *    Persisted on `sources.metadata.instanceUrl` so each sync builds its
 *    HttpClient against the right host.
 *  - `id` URL — identity introspection endpoint. The callback hits it to
 *    learn the org id + display name (testConnection result).
 *  - Salesforce sometimes omits `expires_in` from the token response; we
 *    default to 2h (the Connected App default) so the framework's refresh
 *    threshold check has something to subtract from.
 */

interface SalesforceTokenResponseExtras {
  instance_url?: string;
  id?: string;
  issued_at?: string;
  signature?: string;
}

const DEFAULT_ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const errParam = url.searchParams.get('error');
    if (errParam) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Salesforce returned error: ${errParam}`,
        cause: url.searchParams.get('error_description') ?? undefined,
        fix: 'Restart the connect flow.',
      });
    }
    if (!code || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Salesforce callback missing code or state',
        fix: 'Restart the connect flow from /connections.',
      });
    }

    const { env, db } = await getServerContext();

    if (!env.SALESFORCE_CONNECTOR_CLIENT_ID || !env.SALESFORCE_CONNECTOR_CLIENT_SECRET) {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'Salesforce connector credentials are not configured',
        fix: 'Set SALESFORCE_CONNECTOR_CLIENT_ID and SALESFORCE_CONNECTOR_CLIENT_SECRET.',
      });
    }

    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const publicOrigin = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
    const redirectUri = `${publicOrigin}/api/connectors/salesforce/callback`;

    // Salesforce returns instance_url + id alongside access_token, but the
    // shared OAuth2 strategy only surfaces the standard RFC 6749 fields. We
    // do a second fetch ourselves using the same client credentials so we
    // can read the Salesforce-specific extras.
    const tokenForm = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.SALESFORCE_CONNECTOR_CLIENT_ID,
      client_secret: env.SALESFORCE_CONNECTOR_CLIENT_SECRET,
    });
    const tokenRes = await fetch('https://login.salesforce.com/services/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenForm.toString(),
    });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } & SalesforceTokenResponseExtras;
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Salesforce token exchange returned ${tokenRes.status}: ${tokenJson.error ?? ''}`,
        cause: tokenJson.error_description ?? undefined,
        fix: 'Verify the Connected App callback URL matches WEB_PUBLIC_URL/api/connectors/salesforce/callback.',
      });
    }
    if (!tokenJson.refresh_token) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Salesforce did not return a refresh_token',
        fix: 'Enable the `refresh_token` and `offline_access` scopes on the Connected App; tokens expire ~2h without one.',
      });
    }
    if (!tokenJson.instance_url || !tokenJson.id) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'Salesforce token response missing instance_url or id',
        fix: 'Restart the connect flow; this usually indicates a malformed Connected App.',
      });
    }

    const accessToken = tokenJson.access_token;
    const refreshToken = tokenJson.refresh_token;
    const instanceUrl = tokenJson.instance_url;
    const idUrl = tokenJson.id;
    const expiresInMs = tokenJson.expires_in
      ? tokenJson.expires_in * 1000
      : DEFAULT_ACCESS_TOKEN_TTL_MS;
    const expiresAt = new Date(Date.now() + expiresInMs);

    // Resolve the org identity via the spec's testConnection — keeps the
    // identity-fetch logic in one place (the connector package).
    const spec = createSalesforceSpec({
      clientId: env.SALESFORCE_CONNECTOR_CLIENT_ID,
      clientSecret: env.SALESFORCE_CONNECTOR_CLIENT_SECRET,
    });
    // Ad-hoc HttpClient just to satisfy the testConnection signature;
    // testConnection uses the identity URL directly via fetch, not ctx.api.
    const ident = await spec.testConnection({
      api: undefined as unknown as Parameters<typeof spec.testConnection>[0]['api'],
      tokens: { accessToken, idUrl } as unknown as Parameters<
        typeof spec.testConnection
      >[0]['tokens'],
    });

    const payload = JSON.stringify({
      provider: 'salesforce',
      accessToken,
      refreshToken,
      scope: tokenJson.scope ?? null,
      expiresAtIso: expiresAt.toISOString(),
      instanceUrl,
      idUrl,
      ident: { externalId: ident.externalId, name: ident.name },
    });

    const inserted = await db
      .insert(schema.oauthPendingGrants)
      .values({
        provider: 'salesforce',
        claimedUserId: claims.user_id,
        claimedOrganizationId: claims.organization_id,
        payload,
        expiresAt: new Date(Date.now() + PENDING_GRANT_TTL_MS),
      })
      .returning({ id: schema.oauthPendingGrants.id });
    const grantId = inserted[0]!.id;

    const finalize = new URL('/api/connectors/finalize', env.BETTER_AUTH_URL);
    finalize.searchParams.set('grant', grantId);
    return NextResponse.redirect(finalize);
  } catch (e) {
    let appOrigin: string;
    try {
      const { env: errEnv } = await getServerContext();
      appOrigin = errEnv.BETTER_AUTH_URL;
    } catch {
      appOrigin = new URL(req.url).origin;
    }
    const u = new URL('/connections/oauth-complete', appOrigin);
    u.searchParams.set('provider', 'salesforce');
    u.searchParams.set('status', 'error');
    if (e instanceof HoloError) {
      u.searchParams.set('code', e.code);
      u.searchParams.set('fix', e.fix);
    } else {
      console.error(e);
      u.searchParams.set('code', 'HOLO_INTERNAL');
    }
    return NextResponse.redirect(u);
  }
}
