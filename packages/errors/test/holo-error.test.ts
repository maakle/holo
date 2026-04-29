import { describe, it, expect } from 'vitest';
import { HoloError, holoError } from '../src/index';
import { ErrorCode } from '../src/codes';

describe('HoloError', () => {
  it('exposes code, problem, cause, fix, docs_url fields', () => {
    const err = holoError({
      code: ErrorCode.HOLO_DB_CONNECTION_FAILED,
      problem: 'Cannot reach Postgres',
      cause: 'connection refused',
      fix: 'Check Postgres is running',
      docs_url: 'https://example.com/docs',
    });

    expect(err).toBeInstanceOf(HoloError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('HOLO_DB_CONNECTION_FAILED');
    expect(err.problem).toBe('Cannot reach Postgres');
    expect(err.cause).toBe('connection refused');
    expect(err.fix).toBe('Check Postgres is running');
    expect(err.docs_url).toBe('https://example.com/docs');
  });

  it('serializes to JSON with all fields', () => {
    const err = holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'No session cookie',
      fix: 'Sign in',
    });

    const json = JSON.parse(JSON.stringify(err));
    expect(json).toEqual({
      code: 'HOLO_AUTH_NO_SESSION',
      problem: 'No session cookie',
      fix: 'Sign in',
    });
  });

  it('message field combines code + problem for stack traces', () => {
    const err = holoError({
      code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
      problem: 'GitHub returned error',
      fix: 'Verify client secret',
    });
    expect(err.message).toBe('HOLO_OAUTH_EXCHANGE_FAILED: GitHub returned error');
  });
});
