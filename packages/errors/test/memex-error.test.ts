import { describe, it, expect } from 'vitest';
import { MemexError, memexError } from '../src/index.js';
import { ErrorCode } from '../src/codes.js';

describe('MemexError', () => {
  it('exposes code, problem, cause, fix, docs_url fields', () => {
    const err = memexError({
      code: ErrorCode.MEMEX_DB_CONNECTION_FAILED,
      problem: 'Cannot reach Postgres',
      cause: 'connection refused',
      fix: 'Check Postgres is running',
      docs_url: 'https://example.com/docs',
    });

    expect(err).toBeInstanceOf(MemexError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('MEMEX_DB_CONNECTION_FAILED');
    expect(err.problem).toBe('Cannot reach Postgres');
    expect(err.cause).toBe('connection refused');
    expect(err.fix).toBe('Check Postgres is running');
    expect(err.docs_url).toBe('https://example.com/docs');
  });

  it('serializes to JSON with all fields', () => {
    const err = memexError({
      code: ErrorCode.MEMEX_AUTH_NO_SESSION,
      problem: 'No session cookie',
      fix: 'Sign in',
    });

    const json = JSON.parse(JSON.stringify(err));
    expect(json).toEqual({
      code: 'MEMEX_AUTH_NO_SESSION',
      problem: 'No session cookie',
      fix: 'Sign in',
    });
  });

  it('message field combines code + problem for stack traces', () => {
    const err = memexError({
      code: ErrorCode.MEMEX_OAUTH_EXCHANGE_FAILED,
      problem: 'GitHub returned error',
      fix: 'Verify client secret',
    });
    expect(err.message).toBe('MEMEX_OAUTH_EXCHANGE_FAILED: GitHub returned error');
  });
});
