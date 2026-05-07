import { describe, it, expect } from 'vitest';
import { none } from '../src/auth/none';
import { createHttpClient } from '../src/http/client';

describe('none auth strategy', () => {
  it('declares kind="none" and is not refreshable', () => {
    const strategy = none();
    expect(strategy.kind).toBe('none');
    expect(strategy.refreshable).toBe(false);
  });

  it('does not expose buildAuthorizeUrl / exchangeCode', () => {
    const strategy = none();
    expect(strategy.buildAuthorizeUrl).toBeUndefined();
    expect(strategy.exchangeCode).toBeUndefined();
  });

  it('refresh() throws NOT_IMPLEMENTED', async () => {
    const strategy = none();
    await expect(strategy.refresh({ refreshToken: 'x' })).rejects.toMatchObject({
      code: 'HOLO_CONNECTOR_NOT_IMPLEMENTED',
    });
  });

  it('authHeader returns empty name (signal to skip header injection)', () => {
    const strategy = none();
    expect(strategy.authHeader({ accessToken: '' })).toEqual({ name: '', value: '' });
  });

  it('HttpClient does NOT attach an Authorization header when auth is none()', async () => {
    let captured: Headers | null = null;
    const fetchImpl = (async (_url: unknown, init: RequestInit) => {
      captured = init.headers as Headers;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const client = createHttpClient({
      config: { baseUrl: 'https://example.com' },
      auth: none(),
      tokens: { accessToken: '' },
      fetchImpl,
      sleep: async () => {},
    });
    await client.get('/x');
    // Empty header name is the signal — no Authorization header attached.
    expect(captured!.has('Authorization')).toBe(false);
  });
});
