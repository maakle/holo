import { describe, it, expect } from 'vitest';
import { oauth2 } from '../src/auth/oauth2';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('oauth2 strategy', () => {
  const baseConfig = {
    clientId: 'cid',
    clientSecret: 'csecret',
    authorizeUrl: 'https://example.com/oauth/authorize',
    tokenUrl: 'https://example.com/oauth/token',
    scopes: ['read', 'write'],
    refreshable: true,
  };

  it('builds an authorize URL with state, scopes, redirect_uri', () => {
    const strategy = oauth2(baseConfig);
    const url = strategy.buildAuthorizeUrl!({
      redirectUri: 'https://app/callback',
      state: 'opaque-state',
    });
    expect(url).toContain('https://example.com/oauth/authorize?');
    expect(url).toContain('client_id=cid');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fapp%2Fcallback');
    expect(url).toContain('state=opaque-state');
    expect(url).toContain('scope=read+write');
    expect(url).toContain('response_type=code');
  });

  it('uses comma scope separator when configured (Slack)', () => {
    const strategy = oauth2({ ...baseConfig, scopeSeparator: ',' });
    const url = strategy.buildAuthorizeUrl!({
      redirectUri: 'https://app/callback',
      state: 's',
    });
    expect(url).toContain('scope=read%2Cwrite');
  });

  it('exchanges code for tokens and parses expires_in', async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        access_token: 'a',
        refresh_token: 'r',
        scope: 'read write',
        expires_in: 3600,
      })) as unknown as typeof fetch;
    const strategy = oauth2({ ...baseConfig, fetchImpl });
    const tokens = await strategy.exchangeCode!({
      code: 'auth-code',
      redirectUri: 'https://app/callback',
    });
    expect(tokens.accessToken).toBe('a');
    expect(tokens.refreshToken).toBe('r');
    expect(tokens.scope).toBe('read write');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
  });

  it('throws HOLO_OAUTH_EXCHANGE_FAILED on non-2xx', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'invalid_grant' }, { status: 400 })) as unknown as typeof fetch;
    const strategy = oauth2({ ...baseConfig, fetchImpl });
    await expect(
      strategy.exchangeCode!({ code: 'bad', redirectUri: 'r' }),
    ).rejects.toMatchObject({ code: 'HOLO_OAUTH_EXCHANGE_FAILED' });
  });

  it('honors okPredicate for Slack-style 200-with-error responses', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ ok: false, error: 'invalid_code' })) as unknown as typeof fetch;
    const strategy = oauth2({
      ...baseConfig,
      fetchImpl,
      okPredicate: (json) => (json as { ok?: boolean }).ok === true,
    });
    await expect(
      strategy.exchangeCode!({ code: 'bad', redirectUri: 'r' }),
    ).rejects.toMatchObject({ code: 'HOLO_OAUTH_EXCHANGE_FAILED' });
  });

  it('refresh() throws NOT_IMPLEMENTED when refreshable is false', async () => {
    const strategy = oauth2({ ...baseConfig, refreshable: false });
    await expect(strategy.refresh({ refreshToken: 'r' })).rejects.toMatchObject({
      code: 'HOLO_CONNECTOR_NOT_IMPLEMENTED',
    });
  });

  it('refresh() exchanges refresh_token grant', async () => {
    let captured: URLSearchParams | undefined;
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      captured = new URLSearchParams(init.body as string);
      return jsonResponse({ access_token: 'new-a', refresh_token: 'new-r' });
    }) as unknown as typeof fetch;
    const strategy = oauth2({ ...baseConfig, fetchImpl });
    const tokens = await strategy.refresh({ refreshToken: 'old-r' });
    expect(captured!.get('grant_type')).toBe('refresh_token');
    expect(captured!.get('refresh_token')).toBe('old-r');
    expect(tokens.accessToken).toBe('new-a');
  });

  it('authHeader uses configured scheme', () => {
    const strategy = oauth2({ ...baseConfig, authScheme: 'Token' });
    const header = strategy.authHeader({ accessToken: 't' });
    expect(header).toEqual({ name: 'Authorization', value: 'Token t' });
  });
});
