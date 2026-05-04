import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  shared,
  githubAppConfigFromEnv,
  mintAppJwt,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { enqueueInitialSync } from '@/lib/sync-queue';

interface InstallationResponse {
  id: number;
  account: {
    login: string;
    id: number;
    type: 'User' | 'Organization';
  };
  repository_selection: 'all' | 'selected';
  suspended_at: string | null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const installationIdRaw = url.searchParams.get('installation_id');
    const setupAction = url.searchParams.get('setup_action'); // 'install' | 'update'
    const state = url.searchParams.get('state');

    if (!installationIdRaw || !state) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'GitHub install callback missing installation_id or state',
        fix: 'Restart the install flow from /connections.',
      });
    }
    const installationId = Number.parseInt(installationIdRaw, 10);
    if (!Number.isFinite(installationId)) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: `Invalid installation_id '${installationIdRaw}'`,
        fix: 'Restart the install flow.',
      });
    }

    const { env, db } = await getServerContext();
    const claims = await shared.verifyState(state, env.BETTER_AUTH_SECRET);

    const cookieStore = await cookies();
    const csrfFromCookie = cookieStore.get(shared.CSRF_COOKIE_NAME)?.value;
    if (!csrfFromCookie || csrfFromCookie !== claims.csrf_nonce) {
      throw holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'CSRF nonce mismatch on GitHub install callback',
        fix: 'Restart the install flow. Do not share callback URLs.',
      });
    }
    cookieStore.delete(shared.CSRF_COOKIE_NAME);

    const orgId = claims.organization_id;
    const userId = claims.user_id;

    // Fetch installation metadata so we can store account_login / type / etc.
    // Uses an App-level JWT — we don't have an installation token yet.
    const config = githubAppConfigFromEnv(env);
    const appJwt = await mintAppJwt(config);
    const ghRes = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    );
    if (!ghRes.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `GET /app/installations/${installationId} returned ${ghRes.status}`,
        fix:
          ghRes.status === 401
            ? 'The App private key does not match GITHUB_APP_ID. Verify both env vars.'
            : 'GitHub may be rate limiting; retry the install flow shortly.',
      });
    }
    const installation = (await ghRes.json()) as InstallationResponse;

    // Upsert the github_installations row.
    await db
      .insert(schema.githubInstallations)
      .values({
        organizationId: orgId,
        installationId: installation.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        accountId: installation.account.id,
        repositorySelection: installation.repository_selection,
        installedByUserId: userId,
        suspendedAt: installation.suspended_at ? new Date(installation.suspended_at) : null,
      })
      .onConflictDoUpdate({
        target: [
          schema.githubInstallations.organizationId,
          schema.githubInstallations.installationId,
        ],
        set: {
          accountLogin: installation.account.login,
          accountType: installation.account.type,
          accountId: installation.account.id,
          repositorySelection: installation.repository_selection,
          suspendedAt: installation.suspended_at
            ? new Date(installation.suspended_at)
            : null,
        },
      });

    // Upsert the sources row used by the worker. We key by external_id =
    // <installation_id> so a re-install with a new id creates a new source
    // (rare) rather than colliding with the old one.
    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'github',
        externalId: String(installation.id),
        name: installation.account.login,
        metadata: {
          installation_id: installation.id,
          account_login: installation.account.login,
          account_type: installation.account.type,
        },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: installation.account.login,
          metadata: {
            installation_id: installation.id,
            account_login: installation.account.login,
            account_type: installation.account.type,
          },
          updatedAt: new Date(),
        },
      });

    // Mark the side-effect that an initial sync should fire. We deliberately
    // let GitHub's "select repos" UI act as the allowlist — Phase 3 wires the
    // worker to skip if no repos are reachable, and GitHub's webhook for
    // installation_repositories will keep us synced.
    if (setupAction !== 'update') {
      await enqueueInitialSync(db, orgId, 'github').catch(() => {
        // Best-effort. The 6h scheduler will catch it next tick.
      });
    }

    return NextResponse.redirect(new URL('/connections', req.url));
  } catch (e) {
    if (e instanceof HoloError) {
      const u = new URL('/connections', req.url);
      u.searchParams.set('connect_error', e.code);
      u.searchParams.set('connect_fix', e.fix);
      return NextResponse.redirect(u);
    }
    console.error(e);
    return NextResponse.redirect(new URL('/connections?connect_error=HOLO_INTERNAL', req.url));
  }
}
