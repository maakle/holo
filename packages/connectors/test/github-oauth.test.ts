import { describe, it, expect, vi } from 'vitest';
import { createGithubConnector } from '../src/github/index';
import { MemexError } from '@memex/errors';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, { status, headers: { 'Content-Type': 'text/plain' } });
}

describe('GitHub connector', () => {
  it('builds authorize url with repo read:org scopes', () => {
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec' });
    const url = new URL(
      conn.buildAuthorizeUrl({ redirectUri: 'http://localhost:3000/cb', state: 'STATE' }),
    );
    expect(url.host).toBe('github.com');
    expect(url.pathname).toBe('/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('repo read:org');
    expect(url.searchParams.get('state')).toBe('STATE');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/cb');
  });

  it('exchangeCode parses access_token from a successful response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: 'gho_abc', scope: 'repo,read:org', token_type: 'bearer' }),
    );
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    const tokens = await conn.exchangeCode({ code: 'CODE', redirectUri: 'http://x/cb' });
    expect(tokens.accessToken).toBe('gho_abc');
    expect(tokens.scope).toBe('repo,read:org');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('exchangeCode throws MEMEX_OAUTH_EXCHANGE_FAILED on error response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error: 'bad_verification_code', error_description: 'expired' }),
    );
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    await expect(conn.exchangeCode({ code: 'X', redirectUri: 'http://x/cb' })).rejects.toThrow(
      MemexError,
    );
  });

  it('exchangeCode throws on HTTP non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('boom', 500));
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    await expect(conn.exchangeCode({ code: 'X', redirectUri: 'http://x/cb' })).rejects.toThrow(
      MemexError,
    );
  });

  it('testConnection returns externalId and name from /user', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 12345, login: 'octocat' }));
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    const result = await conn.testConnection({ accessToken: 'gho_abc' });
    expect(result.externalId).toBe('12345');
    expect(result.name).toBe('octocat');
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gho_abc' }),
      }),
    );
  });

  it('testConnection throws on non-2xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse('nope', 401));
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec', fetchImpl });
    await expect(conn.testConnection({ accessToken: 'bad' })).rejects.toThrow(MemexError);
  });

  it('sync methods throw MEMEX_CONNECTOR_NOT_IMPLEMENTED', async () => {
    const conn = createGithubConnector({ clientId: 'cid', clientSecret: 'csec' });
    await expect(
      conn.fullSync(
        { accessToken: 'x' },
        { sourceId: 's', organizationId: 'o', cursorScope: 'all' },
      ),
    ).rejects.toThrow(MemexError);
    await expect(
      conn.incrementalSync(
        { accessToken: 'x' },
        { sourceId: 's', organizationId: 'o', cursorScope: 'all' },
      ),
    ).rejects.toThrow(MemexError);
  });
});
