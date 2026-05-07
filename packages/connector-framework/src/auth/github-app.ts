import { SignJWT } from 'jose';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { ErrorCode, holoError } from '@holo/errors';
import type { AuthStrategy, RefreshInput } from './types';
import type { ConnectorTokens } from '../types';

// GitHub allows app JWT exp up to 10 min; 9 leaves clock-skew headroom.
const APP_JWT_TTL_SECONDS = 9 * 60;
const APP_JWT_BACKDATE_SECONDS = 30;
// Installation tokens live 1 hour; expire our cache 10 min early so a
// long-running call can't get caught with a token expiring mid-flight.
const INSTALLATION_TOKEN_CACHE_TTL_MS = 50 * 60 * 1000;

export interface GithubAppConfig {
  appId: string;
  /** PEM-encoded RSA private key (PKCS#1 or PKCS#8 — both supported). */
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface GithubAppStrategy extends AuthStrategy {
  readonly kind: 'githubApp';
  /** Sign a short-lived app-level JWT (used for App-scoped endpoints). */
  mintAppJwt(): Promise<string>;
  /**
   * Return a fresh installation access token for the given installation,
   * minting via GitHub if the cache is empty or stale. The runtime should
   * call this immediately before each sync and put the result on
   * `ConnectorTokens.accessToken`.
   */
  mintInstallationToken(installationId: number): Promise<string>;
  /** Test-only: clear the in-process token cache. */
  __clearCache(): void;
}

function loadPrivateKey(pem: string): KeyObject {
  try {
    return createPrivateKey({ key: pem, format: 'pem' });
  } catch (cause) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'GitHub App private key is not a valid RSA PEM',
      cause: String(cause),
      fix: 'Re-download the .pem from your GitHub App settings.',
    });
  }
}

interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

export function githubApp(config: GithubAppConfig): GithubAppStrategy {
  const fetchImpl = config.fetchImpl ?? fetch;
  const cache = new Map<number, CachedToken>();

  async function signAppJwt(): Promise<string> {
    const key = loadPrivateKey(config.privateKeyPem);
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(config.appId)
      .setIssuedAt(now - APP_JWT_BACKDATE_SECONDS)
      .setExpirationTime(now + APP_JWT_TTL_SECONDS)
      .sign(key);
  }

  async function mintInstallationToken(installationId: number): Promise<string> {
    const cached = cache.get(installationId);
    if (cached && cached.expiresAt > Date.now()) return cached.token;
    const jwt = await signAppJwt();
    const res = await fetchImpl(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
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
        problem: `GitHub installations/${installationId}/access_tokens returned ${res.status}`,
        cause: body.slice(0, 500),
        fix:
          res.status === 404
            ? 'The installation no longer exists on GitHub. Reinstall the App.'
            : res.status === 401
              ? 'Invalid App private key or App ID.'
              : 'Retry; if it persists, check GitHub status.',
      });
    }
    const json = (await res.json()) as InstallationTokenResponse;
    cache.set(installationId, {
      token: json.token,
      expiresAt: Date.now() + INSTALLATION_TOKEN_CACHE_TTL_MS,
    });
    return json.token;
  }

  return {
    kind: 'githubApp',
    refreshable: true,

    authHeader(tokens: ConnectorTokens) {
      return { name: 'Authorization', value: `Bearer ${tokens.accessToken}` };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub App tokens are minted via mintInstallationToken(), not refreshed',
        fix: 'The runtime should call strategy.mintInstallationToken() before each sync.',
      });
    },

    mintAppJwt: signAppJwt,
    mintInstallationToken,
    __clearCache: () => cache.clear(),
  };
}
