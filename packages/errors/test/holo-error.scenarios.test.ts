import { describe, it, expect } from 'vitest';
import { HoloError, holoError } from '../src/index';
import { ErrorCode } from '../src/codes';

/**
 * Golden-set: the 5+ error scenarios called out in the v0.1 test plan
 * (TODOS.md item #1, "HoloError format (DX D46)").
 *
 * Every entry must:
 *  - throw a `HoloError` with the documented `code`
 *  - have a non-empty human-readable `problem`
 *  - have a non-empty `fix` describing the next action a user/agent can take
 *  - serialize to a JSON shape that downstream callers (Slack bot blocks,
 *    web error responses, MCP tool errors) can render without massaging
 *
 * `docs_url` is optional today — TODOS.md flags it as a v0.1 requirement;
 * once we ship the `/docs/errors/<code>.md` set, lift the optional `?` and
 * make this test require it.
 */
const SCENARIOS: ReadonlyArray<{
  scenario: string;
  build: () => HoloError;
  expectedCode: keyof typeof ErrorCode;
}> = [
  {
    scenario: 'missing token (Notion)',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_NOTION_TOKEN_INVALID,
        problem: 'Notion API rejected the token (401)',
        cause: 'invalid_grant or revoked install',
        fix: 'Reconnect Notion in the holo dashboard.',
      }),
    expectedCode: 'HOLO_NOTION_TOKEN_INVALID',
  },
  {
    scenario: 'missing token (GitHub)',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_GITHUB_TOKEN_INVALID,
        problem: 'GitHub installation token rejected (401)',
        cause: 'installation may have been deleted or scopes revoked',
        fix: 'Reinstall the GitHub App from the holo dashboard.',
      }),
    expectedCode: 'HOLO_GITHUB_TOKEN_INVALID',
  },
  {
    scenario: 'OAuth exchange failure',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
        problem: 'OAuth code exchange returned 400',
        cause: 'invalid_grant',
        fix: 'Restart the connect flow — the auth code may have expired.',
      }),
    expectedCode: 'HOLO_OAUTH_EXCHANGE_FAILED',
  },
  {
    scenario: 'ingestion rate limit',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_INGESTION_RATE_LIMITED,
        problem: 'Source API returned 429 too many times in a row',
        fix: 'Sync will retry on the next 6h schedule. Reduce concurrent allowlist patterns to lower load.',
      }),
    expectedCode: 'HOLO_INGESTION_RATE_LIMITED',
  },
  {
    scenario: 'search miss (artifact not found)',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_ARTIFACT_NOT_FOUND,
        problem: 'No artifact with that id exists in this organization',
        fix: 'Try the parent artifact or run search() again to get fresh ids.',
      }),
    expectedCode: 'HOLO_ARTIFACT_NOT_FOUND',
  },
  {
    scenario: 'allowlist empty (silent-drift guard)',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_ALLOWLIST_EMPTY,
        problem: 'No include rows in the allowlist for this provider',
        fix: 'Add at least one allowlist entry: `holo allowlist add <provider> <pattern>`.',
      }),
    expectedCode: 'HOLO_ALLOWLIST_EMPTY',
  },
  {
    scenario: 'no active workspace',
    build: () =>
      holoError({
        code: ErrorCode.HOLO_AUTH_NO_ACTIVE_ORG,
        problem: 'Session has no active workspace',
        fix: 'Switch to a workspace via the org switcher, or sign out and in again.',
      }),
    expectedCode: 'HOLO_AUTH_NO_ACTIVE_ORG',
  },
];

describe('HoloError v0.1 golden-set scenarios', () => {
  it.each(SCENARIOS)('$scenario → HOLO_$expectedCode shape', ({ build, expectedCode }) => {
    const err = build();

    expect(err).toBeInstanceOf(HoloError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(ErrorCode[expectedCode]);

    // Required fields: caller-actionable text in both `problem` and `fix`.
    expect(err.problem).toBeTruthy();
    expect(err.problem).not.toMatch(/TODO|FIXME|placeholder/i);
    expect(err.fix).toBeTruthy();
    expect(err.fix).not.toMatch(/TODO|FIXME|placeholder/i);
    expect(err.fix.length).toBeGreaterThan(15);

    // Stack-trace surface combines code + problem so logs index by code.
    expect(err.message).toContain(err.code);
    expect(err.message).toContain(err.problem);

    // JSON shape: every defined field must round-trip. `cause` and `docs_url`
    // are optional; when present they must be present in JSON too.
    const json = JSON.parse(JSON.stringify(err));
    expect(json.code).toBe(err.code);
    expect(json.problem).toBe(err.problem);
    expect(json.fix).toBe(err.fix);
    if (err.cause !== undefined) expect(json.cause).toBe(err.cause);
    if (err.docs_url !== undefined) expect(json.docs_url).toBe(err.docs_url);
  });

  it('every ErrorCode value is a unique non-empty string', () => {
    const values = Object.values(ErrorCode);
    expect(values.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const v of values) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
      expect(v.startsWith('HOLO_')).toBe(true);
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
  });

  it('covers at least the 5 scenarios required by the v0.1 test plan', () => {
    // The plan minimum: missing token, OAuth failure, ingestion fail, search
    // miss, rate limit. We exceed it (7) — but assert the floor here so a
    // future contributor can't drop below the v0.1 contract by accident.
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(5);
  });
});
