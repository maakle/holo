import { describe, it, expect, vi } from 'vitest';
import { createHubspotConnector } from '../../src/hubspot/index';
import { HoloError } from '@holo/errors';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HubSpot connector (Service Key)', () => {
  it('testConnection calls /account-info/v3/details with bearer auth and returns hub identity', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        portalId: 12345,
        accountType: 'STANDARD',
        timeZone: 'US/Eastern',
      }),
    );
    const conn = createHubspotConnector({ apiKey: 'hssk_abc', fetchImpl });
    const ident = await conn.testConnection({ accessToken: 'unused' });
    expect(ident.ok).toBe(true);
    expect(ident.externalId).toBe('12345');
    expect(ident.name).toContain('12345');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.hubapi.com/account-info/v3/details',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer hssk_abc' }),
      }),
    );
  });

  it('OAuth methods throw HOLO_CONNECTOR_NOT_IMPLEMENTED', async () => {
    const conn = createHubspotConnector({ apiKey: 'hssk_abc' });
    expect(() =>
      conn.buildAuthorizeUrl({ redirectUri: 'http://x/cb', state: 'S' }),
    ).toThrow(HoloError);
    await expect(
      conn.exchangeCode({ code: 'X', redirectUri: 'http://x/cb' }),
    ).rejects.toThrow(HoloError);
    await expect(conn.refresh({ refreshToken: 'X' })).rejects.toThrow(HoloError);
  });

  it('fullSync throws when db/enqueueEmbed not provided', async () => {
    const conn = createHubspotConnector({ apiKey: 'hssk_abc' });
    await expect(
      conn.fullSync(
        { accessToken: 'unused' },
        { sourceId: 's', organizationId: 'o', cursorScope: 'sync' },
      ),
    ).rejects.toThrow(HoloError);
  });

  it('verifyWebhook returns false (Service Keys cannot authenticate webhooks)', () => {
    const conn = createHubspotConnector({ apiKey: 'hssk_abc' });
    expect(conn.verifyWebhook({ rawBody: '{}', headers: {} }, 'secret')).toBe(false);
  });
});
