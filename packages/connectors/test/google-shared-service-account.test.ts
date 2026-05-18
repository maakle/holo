import { describe, it, expect } from 'vitest';
import { exportPKCS8, generateKeyPair, decodeJwt } from 'jose';
import { mintAppAccessToken } from '../src/google-shared/service-account';
import type { GoogleServiceAccountKey } from '../src/google-shared/service-account';
import { GOOGLE_CHAT_APP_SCOPES } from '@holo/sync-providers';

async function fakeSaKey(): Promise<{ key: GoogleServiceAccountKey; pem: string }> {
  const { privateKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
    extractable: true,
  });
  const pem = await exportPKCS8(privateKey);
  const key: GoogleServiceAccountKey = {
    type: 'service_account',
    project_id: 'holo-test',
    private_key_id: 'kid-test',
    private_key: pem,
    client_email: 'holo-test@holo-test.iam.gserviceaccount.com',
    client_id: '1234567890',
  };
  return { key, pem };
}

interface CapturedTokenRequest {
  url: string;
  body: string;
}

function makeFakeFetch(
  captured: CapturedTokenRequest[],
  responseBody: object = { access_token: 'fake-token', expires_in: 3600 },
): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('mintAppAccessToken', () => {
  it('signs a JWT with no `sub` claim — app-level auth, no impersonation', async () => {
    const { key } = await fakeSaKey();
    const captured: CapturedTokenRequest[] = [];
    await mintAppAccessToken({
      key,
      scopes: GOOGLE_CHAT_APP_SCOPES,
      fetchImpl: makeFakeFetch(captured),
    });

    expect(captured).toHaveLength(1);
    const params = new URLSearchParams(captured[0]!.body);
    const assertion = params.get('assertion');
    expect(assertion).toBeTruthy();
    const claims = decodeJwt(assertion!);
    // The load-bearing assertion: no `sub` means no impersonation.
    expect(claims.sub).toBeUndefined();
    expect(claims.iss).toBe(key.client_email);
    expect(claims.scope).toBe('https://www.googleapis.com/auth/chat.bot');
  });

  it('returns the access token and a future expiry', async () => {
    const { key } = await fakeSaKey();
    const result = await mintAppAccessToken({
      key,
      scopes: GOOGLE_CHAT_APP_SCOPES,
      fetchImpl: makeFakeFetch([]),
    });
    expect(result.accessToken).toBe('fake-token');
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws HOLO_OAUTH_EXCHANGE_FAILED when Google rejects the JWT', async () => {
    const { key } = await fakeSaKey();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: 'invalid_grant', error_description: 'bad SA' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )) as unknown as typeof fetch;

    await expect(
      mintAppAccessToken({
        key,
        scopes: GOOGLE_CHAT_APP_SCOPES,
        fetchImpl,
      }),
    ).rejects.toThrow(/app mode.*failed.*invalid_grant/);
  });

  it('contrast with delegated mode: app token has scope but no sub', async () => {
    // Sanity check that GOOGLE_CHAT_APP_SCOPES is exactly the chat.bot scope
    // and nothing else. If this drifts, the bot-in-space auth contract breaks.
    expect(GOOGLE_CHAT_APP_SCOPES).toEqual(['https://www.googleapis.com/auth/chat.bot']);
  });
});
