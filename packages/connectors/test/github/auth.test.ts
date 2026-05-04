import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { jwtVerify, importSPKI } from 'jose';
import {
  __clearGithubAppTokenCacheForTests,
  githubAppConfigFromEnv,
  mintAppJwt,
  mintInstallationToken,
  uninstallApp,
} from '../../src/github/auth';

function generateTestKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

describe('github app auth', () => {
  beforeEach(() => {
    __clearGithubAppTokenCacheForTests();
  });

  describe('mintAppJwt', () => {
    it('returns a JWT with the App ID as issuer and a 9-minute expiry', async () => {
      const { privateKeyPem, publicKeyPem } = generateTestKeyPair();
      const token = await mintAppJwt({
        appId: '1234567',
        privateKeyPem,
      });

      // Verify with the matching public key. If signing used the wrong alg or
      // key, this throws.
      const publicKey = await importSPKI(publicKeyPem, 'RS256');
      const { payload } = await jwtVerify(token, publicKey);

      expect(payload.iss).toBe('1234567');
      expect(typeof payload.iat).toBe('number');
      expect(typeof payload.exp).toBe('number');
      const lifetime = (payload.exp as number) - (payload.iat as number);
      // 9 min payload lifetime + 30s backdate = 570s window between iat and exp.
      expect(lifetime).toBeGreaterThanOrEqual(540);
      expect(lifetime).toBeLessThanOrEqual(600);
    });

    it('rejects an invalid PEM key with a clear error', async () => {
      await expect(
        mintAppJwt({ appId: '1', privateKeyPem: 'not a pem' }),
      ).rejects.toThrow();
    });
  });

  describe('mintInstallationToken', () => {
    it('exchanges an App JWT for an installation token via the GitHub endpoint', async () => {
      const { privateKeyPem } = generateTestKeyPair();

      let capturedUrl = '';
      let capturedAuthHeader = '';
      const fetchImpl: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedAuthHeader = String(
          (init?.headers as Record<string, string>)['Authorization'] ?? '',
        );
        return new Response(
          JSON.stringify({
            token: 'ghs_fake_installation_token',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      };

      const token = await mintInstallationToken({
        config: { appId: '1', privateKeyPem },
        installationId: 42,
        fetchImpl,
      });

      expect(token).toBe('ghs_fake_installation_token');
      expect(capturedUrl).toBe(
        'https://api.github.com/app/installations/42/access_tokens',
      );
      expect(capturedAuthHeader.startsWith('Bearer ')).toBe(true);
    });

    it('throws a helpful HoloError when GitHub returns 404', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      const fetchImpl: typeof fetch = async () =>
        new Response('{"message":"not found"}', { status: 404 });

      await expect(
        mintInstallationToken({
          config: { appId: '1', privateKeyPem },
          installationId: 99,
          fetchImpl,
        }),
      ).rejects.toMatchObject({
        code: 'HOLO_FETCH_FAILED',
        problem: expect.stringContaining('404'),
        fix: expect.stringContaining('reinstall'),
      });
    });

    it('throws a helpful HoloError when GitHub returns 401 (key/app mismatch)', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      const fetchImpl: typeof fetch = async () =>
        new Response('{"message":"jwt invalid"}', { status: 401 });

      await expect(
        mintInstallationToken({
          config: { appId: '1', privateKeyPem },
          installationId: 99,
          fetchImpl,
        }),
      ).rejects.toMatchObject({
        code: 'HOLO_FETCH_FAILED',
        fix: expect.stringContaining('GITHUB_APP_PRIVATE_KEY'),
      });
    });
  });

  describe('uninstallApp', () => {
    it('reports uninstalled=true on a 204 response', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      let capturedMethod = '';
      let capturedUrl = '';
      const fetchImpl: typeof fetch = async (input, init) => {
        capturedMethod = String(init?.method ?? 'GET');
        capturedUrl = String(input);
        return new Response(null, { status: 204 });
      };
      const result = await uninstallApp({
        config: { appId: '1', privateKeyPem },
        installationId: 42,
        fetchImpl,
      });
      expect(result.uninstalled).toBe(true);
      expect(capturedMethod).toBe('DELETE');
      expect(capturedUrl).toBe('https://api.github.com/app/installations/42');
    });

    it('treats 404 as a successful no-op (already gone)', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      const fetchImpl: typeof fetch = async () =>
        new Response('{"message":"not found"}', { status: 404 });
      const result = await uninstallApp({
        config: { appId: '1', privateKeyPem },
        installationId: 99,
        fetchImpl,
      });
      expect(result.uninstalled).toBe(false);
    });

    it('throws on 401 with a clear key/app id mismatch fix', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      const fetchImpl: typeof fetch = async () =>
        new Response('{"message":"jwt invalid"}', { status: 401 });
      await expect(
        uninstallApp({
          config: { appId: '1', privateKeyPem },
          installationId: 99,
          fetchImpl,
        }),
      ).rejects.toMatchObject({
        code: 'HOLO_FETCH_FAILED',
        fix: expect.stringContaining('private key'),
      });
    });

    it('throws on other non-2xx responses', async () => {
      const { privateKeyPem } = generateTestKeyPair();
      const fetchImpl: typeof fetch = async () =>
        new Response('{"message":"server error"}', { status: 500 });
      await expect(
        uninstallApp({
          config: { appId: '1', privateKeyPem },
          installationId: 99,
          fetchImpl,
        }),
      ).rejects.toMatchObject({
        code: 'HOLO_FETCH_FAILED',
        problem: expect.stringContaining('500'),
      });
    });
  });

  describe('githubAppConfigFromEnv', () => {
    it('decodes the base64 private key', () => {
      const pem =
        '-----BEGIN PRIVATE KEY-----\nMOCKED_KEY_BODY\n-----END PRIVATE KEY-----\n';
      const config = githubAppConfigFromEnv({
        GITHUB_APP_ID: '42',
        GITHUB_APP_PRIVATE_KEY_B64: Buffer.from(pem, 'utf8').toString('base64'),
      });
      expect(config.appId).toBe('42');
      expect(config.privateKeyPem).toBe(pem);
    });

    it('throws if either value is missing', () => {
      expect(() =>
        githubAppConfigFromEnv({ GITHUB_APP_ID: '42' }),
      ).toThrow();
      expect(() =>
        githubAppConfigFromEnv({ GITHUB_APP_PRIVATE_KEY_B64: 'x'.repeat(40) }),
      ).toThrow();
    });
  });
});
