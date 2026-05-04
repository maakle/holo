/**
 * GitHub App auth helper.
 *
 * Mints short-lived (≤1 hour) installation access tokens by signing a JWT
 * with the App's private key, exchanging it at GitHub's
 * `/app/installations/{id}/access_tokens` endpoint, and caching the result
 * in-process for ~50 minutes.
 *
 * The worker calls `loadGithubInstallationToken` on every sync. The actual
 * key parsing and HTTP call happen once per cache window.
 */
import { SignJWT, importPKCS8 } from 'jose';
import { and, eq, isNull } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';

// GitHub allows JWT exp up to 10 min; we use 9 to leave clock-skew headroom.
const APP_JWT_TTL_SECONDS = 9 * 60;
const APP_JWT_BACKDATE_SECONDS = 30; // tolerate slight clock skew on GitHub's side
// Installation tokens live 1 hour; we expire our cache 10 min early so a
// long-running call doesn't get caught with a token that expires mid-flight.
const INSTALLATION_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

export interface GithubAppConfig {
  appId: string;
  /** PEM-encoded RSA private key (already base64-decoded if env is `_B64`). */
  privateKeyPem: string;
}

interface CachedToken {
  token: string;
  /** Unix epoch ms when this entry should be discarded. */
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

// Test seam — lets unit tests reset state between cases.
export function __clearGithubAppTokenCacheForTests(): void {
  tokenCache.clear();
}

async function signAppJwt(config: GithubAppConfig): Promise<string> {
  const key = await importPKCS8(config.privateKeyPem, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.appId)
    .setIssuedAt(now - APP_JWT_BACKDATE_SECONDS)
    .setExpirationTime(now + APP_JWT_TTL_SECONDS)
    .sign(key);
}

/**
 * Sign and return a short-lived JWT identifying our App. Used for endpoints
 * that operate at the App level (not a specific installation): looking up
 * installations by id, listing installations, deleting an installation.
 */
export async function mintAppJwt(config: GithubAppConfig): Promise<string> {
  return signAppJwt(config);
}

interface MintInstallationTokenInput {
  config: GithubAppConfig;
  installationId: number;
  fetchImpl?: typeof fetch;
}

interface InstallationAccessTokenResponse {
  token: string;
  expires_at: string;
}

/**
 * Force a fresh token mint, bypassing the cache. Use when an in-flight call
 * gets a 401 — likely a token that GitHub revoked early.
 */
export async function mintInstallationToken(
  input: MintInstallationTokenInput,
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const jwt = await signAppJwt(input.config);
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${input.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `GitHub /app/installations/${input.installationId}/access_tokens returned ${res.status}`,
      cause: body.slice(0, 500),
      fix:
        res.status === 404
          ? 'The installation no longer exists on GitHub. The admin must reinstall the holo App.'
          : res.status === 401
            ? 'The App private key is invalid or App ID does not match. Verify GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64.'
            : 'Retry the sync; if it persists, check GitHub status.',
    });
  }
  const json = (await res.json()) as InstallationAccessTokenResponse;
  tokenCache.set(input.installationId, {
    token: json.token,
    expiresAt: Date.now() + INSTALLATION_TOKEN_CACHE_TTL_MS,
  });
  return json.token;
}

/**
 * Look up the installation row for `organizationId`, mint (or reuse a cached)
 * installation access token, and return it. Throws if no installation is
 * registered for the org or if GitHub has suspended it.
 */
export async function loadGithubInstallationToken(args: {
  db: DB;
  organizationId: string;
  config: GithubAppConfig;
  fetchImpl?: typeof fetch;
}): Promise<{ token: string; installationId: number }> {
  const rows = await args.db
    .select({
      installationId: schema.githubInstallations.installationId,
      suspendedAt: schema.githubInstallations.suspendedAt,
    })
    .from(schema.githubInstallations)
    .where(
      and(
        eq(schema.githubInstallations.organizationId, args.organizationId),
        isNull(schema.githubInstallations.suspendedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: `No active GitHub App installation for organization ${args.organizationId}`,
      fix: 'Install the holo GitHub App from the connections page before triggering a sync.',
    });
  }

  const installationId = row.installationId;
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    return { token: cached.token, installationId };
  }
  const token = await mintInstallationToken({
    config: args.config,
    installationId,
    fetchImpl: args.fetchImpl,
  });
  return { token, installationId };
}

/**
 * Uninstalls the App from a GitHub account. Called when the user clicks
 * Disconnect in our UI — without this, the holo App stays installed on
 * GitHub even after we've forgotten about it locally, which leaves the
 * admin to clean up manually at github.com/settings/installations.
 *
 * Uses an App-level JWT (the App can manage its own installations); no
 * installation token needed.
 *
 * Returns whether the uninstall actually happened. We treat 404 as a
 * successful no-op — if GitHub already has no record of the installation,
 * we've reached the desired state regardless. Other failures throw.
 */
export async function uninstallApp(args: {
  config: GithubAppConfig;
  installationId: number;
  fetchImpl?: typeof fetch;
}): Promise<{ uninstalled: boolean }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const jwt = await signAppJwt(args.config);
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${args.installationId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  );
  // GitHub returns 204 on a successful uninstall.
  if (res.status === 204) {
    tokenCache.delete(args.installationId);
    return { uninstalled: true };
  }
  if (res.status === 404) {
    // Already gone on GitHub's side. Drop any cached token and report no-op.
    tokenCache.delete(args.installationId);
    return { uninstalled: false };
  }
  const body = await res.text().catch(() => '');
  throw holoError({
    code: ErrorCode.HOLO_FETCH_FAILED,
    problem: `GitHub DELETE /app/installations/${args.installationId} returned ${res.status}`,
    cause: body.slice(0, 500),
    fix:
      res.status === 401
        ? 'The App private key does not match GITHUB_APP_ID. Verify both env vars.'
        : 'Retry the disconnect; if it persists, check GitHub status.',
  });
}

/**
 * Lists every repo the org's installation has access to. Pages through GitHub's
 * `/installation/repositories` endpoint using the installation token. Used by
 * the worker as a fallback when the user hasn't narrowed the allowlist via
 * the picker — installations already have admin-curated repo selection on
 * GitHub's side.
 */
export async function listInstallationRepos(args: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<string[]> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const out: string[] = [];
  let page = 1;
  while (page <= 10) {
    const url = new URL('https://api.github.com/installation/repositories');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const res = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `GitHub /installation/repositories returned ${res.status}`,
        fix: 'Ensure the holo App is installed and has access to at least one repo.',
      });
    }
    const body = (await res.json()) as { repositories: Array<{ full_name: string }> };
    out.push(...body.repositories.map((r) => r.full_name));
    if (body.repositories.length < 100) break;
    page += 1;
  }
  return out;
}

/**
 * Build a `GithubAppConfig` from environment variables. Throws if any of the
 * required env vars are missing — the caller (worker bootstrap, web route)
 * should surface that as a setup error rather than a runtime sync failure.
 */
export function githubAppConfigFromEnv(env: {
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY_B64?: string;
}): GithubAppConfig {
  const appId = env.GITHUB_APP_ID;
  const keyB64 = env.GITHUB_APP_PRIVATE_KEY_B64;
  if (!appId || !keyB64) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY_B64 must both be set',
      fix:
        'Register a GitHub App, generate a private key, base64-encode it ' +
        '(`base64 -i key.pem | tr -d \'\\n\'`), and add the values to your .env.',
    });
  }
  const privateKeyPem = Buffer.from(keyB64, 'base64').toString('utf8');
  return { appId, privateKeyPem };
}
