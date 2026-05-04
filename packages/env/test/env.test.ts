import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/index';
import { HoloError } from '@holo/errors';

const COMPLETE_ENV = {
  DATABASE_URL: 'postgresql://localhost/holo',
  REDIS_URL: 'redis://localhost:6379',
  HOLO_TOKEN_ENCRYPTION_KEY: 'a'.repeat(44),
  BETTER_AUTH_SECRET: 'b'.repeat(44),
  BETTER_AUTH_URL: 'http://localhost:3000',
  GITHUB_LOGIN_CLIENT_ID: 'lid',
  GITHUB_LOGIN_CLIENT_SECRET: 'lsec',
  EMAIL_PROVIDER: 'console',
  NODE_ENV: 'development',
};

describe('parseEnv', () => {
  it('parses a complete env object', () => {
    const env = parseEnv(COMPLETE_ENV);
    expect(env.DATABASE_URL).toBe('postgresql://localhost/holo');
    expect(env.NODE_ENV).toBe('development');
  });

  it('throws HOLO_ENV_INVALID when required vars missing', () => {
    expect(() => parseEnv({})).toThrow(HoloError);
    try {
      parseEnv({});
    } catch (e) {
      expect((e as HoloError).code).toBe('HOLO_ENV_INVALID');
      expect((e as HoloError).cause).toContain('DATABASE_URL');
    }
  });

  it('rejects EMAIL_PROVIDER outside the enum', () => {
    expect(() =>
      parseEnv({
        ...COMPLETE_ENV,
        EMAIL_PROVIDER: 'sendgrid',
      }),
    ).toThrow(HoloError);
  });
});
