import { describe, it, expect } from 'vitest';
import { apiKey } from '../src/auth/api-key';

describe('apiKey strategy', () => {
  it('defaults to Authorization: Bearer', () => {
    const strategy = apiKey();
    expect(strategy.authHeader({ accessToken: 'k' })).toEqual({
      name: 'Authorization',
      value: 'Bearer k',
    });
  });

  it('supports custom header name and prefix', () => {
    const strategy = apiKey({ header: 'X-Api-Key', prefix: '' });
    expect(strategy.authHeader({ accessToken: 'k' })).toEqual({
      name: 'X-Api-Key',
      value: 'k',
    });
  });

  it('refresh() throws NOT_IMPLEMENTED', async () => {
    const strategy = apiKey();
    await expect(strategy.refresh({ refreshToken: 'r' })).rejects.toMatchObject({
      code: 'HOLO_CONNECTOR_NOT_IMPLEMENTED',
    });
  });

  it('does not expose buildAuthorizeUrl or exchangeCode', () => {
    const strategy = apiKey();
    expect(strategy.buildAuthorizeUrl).toBeUndefined();
    expect(strategy.exchangeCode).toBeUndefined();
  });
});
