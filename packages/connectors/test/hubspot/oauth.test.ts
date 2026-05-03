import { describe, it, expect, vi } from 'vitest';
import { createHubspotConnector } from '../../src/hubspot/index';
import { HoloError } from '@holo/errors';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('HubSpot connector', () => {
  it('builds authorize url with the v0.0 scope set', () => {
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec' });
    const url = new URL(
      conn.buildAuthorizeUrl({ redirectUri: 'http://localhost:3000/cb', state: 'STATE' }),
    );
    expect(url.host).toBe('app.hubspot.com');
    expect(url.pathname).toBe('/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/cb');
    expect(url.searchParams.get('response_type')).toBe('code');
    const scope = url.searchParams.get('scope') ?? '';
    expect(scope).toContain('oauth');
    expect(scope).toContain('crm.objects.contacts.read');
    expect(scope).toContain('crm.objects.deals.read');
    expect(scope).toContain('crm.objects.companies.read');
  });

  it('exchangeCode posts form-urlencoded and parses tokens', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        access_token: 'hs_abc',
        refresh_token: 'hs_refresh',
        expires_in: 21600,
        token_type: 'bearer',
      }),
    );
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    const tokens = await conn.exchangeCode({ code: 'CODE', redirectUri: 'http://x/cb' });
    expect(tokens.accessToken).toBe('hs_abc');
    expect(tokens.refreshToken).toBe('hs_refresh');
    expect(tokens.expiresAt).toBeInstanceOf(Date);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hubapi.com/oauth/v1/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );
    const sentBody = String((fetchImpl.mock.calls[0]![1] as RequestInit).body);
    expect(sentBody).toContain('grant_type=authorization_code');
    expect(sentBody).toContain('client_id=cid');
    expect(sentBody).toContain('client_secret=csec');
    expect(sentBody).toContain('code=CODE');
  });

  it('exchangeCode throws HOLO_OAUTH_EXCHANGE_FAILED on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('boom', 400));
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    await expect(
      conn.exchangeCode({ code: 'X', redirectUri: 'http://x/cb' }),
    ).rejects.toThrow(HoloError);
  });

  it('exchangeCode throws when response lacks access_token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'no_token' }));
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    await expect(
      conn.exchangeCode({ code: 'X', redirectUri: 'http://x/cb' }),
    ).rejects.toThrow(HoloError);
  });

  it('refresh sends grant_type=refresh_token and preserves refreshToken if missing in response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'hs_new', expires_in: 21600 }),
    );
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    const tokens = await conn.refresh({ refreshToken: 'hs_refresh' });
    expect(tokens.accessToken).toBe('hs_new');
    expect(tokens.refreshToken).toBe('hs_refresh'); // preserved from input
    const sentBody = String((fetchImpl.mock.calls[0]![1] as RequestInit).body);
    expect(sentBody).toContain('grant_type=refresh_token');
    expect(sentBody).toContain('refresh_token=hs_refresh');
  });

  it('testConnection introspects the token and returns hub identity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        hub_id: 12345,
        hub_domain: 'acme.hubspot.com',
        app_id: 999,
        user_id: 42,
        scopes: ['oauth', 'crm.objects.contacts.read'],
        token_type: 'bearer',
      }),
    );
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    const ident = await conn.testConnection({ accessToken: 'hs_abc' });
    expect(ident.ok).toBe(true);
    expect(ident.externalId).toBe('12345');
    expect(ident.name).toBe('acme.hubspot.com');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hubapi.com/oauth/v1/access-tokens/hs_abc',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('fullSync throws HOLO_CONNECTOR_NOT_IMPLEMENTED (sync engine pending)', async () => {
    const conn = createHubspotConnector({ clientId: 'cid', clientSecret: 'csec' });
    await expect(
      conn.fullSync(
        { accessToken: 'hs_abc' },
        { sourceId: 's', organizationId: 'o', cursorScope: 'all' },
      ),
    ).rejects.toThrow(HoloError);
  });
});
