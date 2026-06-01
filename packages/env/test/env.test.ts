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

  it('rejects EMAIL_PROVIDER=resend without RESEND_API_KEY and EMAIL_FROM', () => {
    try {
      parseEnv({ ...COMPLETE_ENV, EMAIL_PROVIDER: 'resend' });
      throw new Error('expected parseEnv to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HoloError);
      expect((e as HoloError).cause).toMatch(/RESEND_API_KEY and EMAIL_FROM/);
    }
    try {
      parseEnv({
        ...COMPLETE_ENV,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_xxx',
      });
      throw new Error('expected parseEnv to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HoloError);
      expect((e as HoloError).cause).toMatch(/EMAIL_FROM/);
    }
  });

  it('accepts EMAIL_PROVIDER=resend when RESEND_API_KEY and EMAIL_FROM are set', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 're_xxx',
      EMAIL_FROM: 'Holo <noreply@example.com>',
    });
    expect(env.EMAIL_PROVIDER).toBe('resend');
    expect(env.EMAIL_FROM).toBe('Holo <noreply@example.com>');
  });
});

describe('GATEWAY_INTERNAL_URL', () => {
  it('parses when set to a valid URL', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      GATEWAY_INTERNAL_URL: 'http://gateway:8080',
    });
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://gateway:8080');
  });

  it('defaults to http://localhost:8080 when unset', () => {
    const env = parseEnv(COMPLETE_ENV);
    expect(env.GATEWAY_INTERNAL_URL).toBe('http://localhost:8080');
  });
});

describe('MCP_PUBLIC_URL derivation', () => {
  it('defaults to WEB_PUBLIC_URL when MCP_PUBLIC_URL is unset', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: 'https://holo.example.com',
      MCP_PUBLIC_URL: undefined,
    });
    expect(env.MCP_PUBLIC_URL).toBe('https://holo.example.com');
  });

  it('keeps MCP_PUBLIC_URL when explicitly set (two-origin mode)', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: 'https://holo.example.com',
      MCP_PUBLIC_URL: 'https://gateway.example.com',
    });
    expect(env.MCP_PUBLIC_URL).toBe('https://gateway.example.com');
  });

  it('falls back to BETTER_AUTH_URL when neither is set (dev default)', () => {
    const env = parseEnv({
      ...COMPLETE_ENV,
      WEB_PUBLIC_URL: undefined,
      MCP_PUBLIC_URL: undefined,
    });
    expect(env.MCP_PUBLIC_URL).toBe(COMPLETE_ENV.BETTER_AUTH_URL);
  });
});
