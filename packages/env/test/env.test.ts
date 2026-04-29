import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/index.js';
import { MemexError } from '@memex/errors';

const COMPLETE_ENV = {
  DATABASE_URL: 'postgresql://localhost/memex',
  REDIS_URL: 'redis://localhost:6379',
  MEMEX_TOKEN_ENCRYPTION_KEY: 'a'.repeat(44),
  BETTER_AUTH_SECRET: 'b'.repeat(44),
  BETTER_AUTH_URL: 'http://localhost:3000',
  GITHUB_LOGIN_CLIENT_ID: 'lid',
  GITHUB_LOGIN_CLIENT_SECRET: 'lsec',
  GITHUB_CONNECTOR_CLIENT_ID: 'cid',
  GITHUB_CONNECTOR_CLIENT_SECRET: 'csec',
  EMAIL_PROVIDER: 'console',
  NODE_ENV: 'development',
};

describe('parseEnv', () => {
  it('parses a complete env object', () => {
    const env = parseEnv(COMPLETE_ENV);
    expect(env.DATABASE_URL).toBe('postgresql://localhost/memex');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws MEMEX_ENV_INVALID when required vars missing', () => {
    expect(() => parseEnv({})).toThrow(MemexError);
    try {
      parseEnv({});
    } catch (e) {
      expect((e as MemexError).code).toBe('MEMEX_ENV_INVALID');
      expect((e as MemexError).cause).toContain('DATABASE_URL');
    }
  });

  it('rejects EMAIL_PROVIDER outside the enum', () => {
    expect(() =>
      parseEnv({
        ...COMPLETE_ENV,
        EMAIL_PROVIDER: 'sendgrid',
      }),
    ).toThrow(MemexError);
  });
});
