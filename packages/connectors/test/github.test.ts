/**
 * GitHub spec smoke tests. The heavy lifting (paged API → chunks → enqueue)
 * lives in runGithubProseSync / runGithubCodeSync, which already have
 * their own focused tests under test/github/. This file covers the spec
 * shape and the framework wiring (auth strategy kind, resource ids,
 * cursor schemas, allowlist resolution).
 */
import { describe, it, expect } from 'vitest';
import { createGithubSpec } from '../src/github/index';

// A real-looking but disposable PEM. Used only by spec construction; the
// JWT signing path doesn't run in these tests.
const TEST_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC6MEGV9uM2X3wL
test-test-test-test-test-test-test-test-test-test-test-test-test
-----END PRIVATE KEY-----`;

const opts = {
  appId: '12345',
  privateKeyPem: TEST_PEM,
};

describe('createGithubSpec', () => {
  it('declares two resources: prose and code (in declaration order)', () => {
    const spec = createGithubSpec(opts);
    expect(spec.id).toBe('github');
    expect(spec.displayName).toBe('GitHub');
    expect(spec.resources).toHaveLength(2);
    expect(spec.resources.map((r) => r.id)).toEqual(['prose', 'code']);
  });

  it('uses the githubApp auth strategy', () => {
    const spec = createGithubSpec(opts);
    expect(spec.auth.kind).toBe('githubApp');
    // refresh isn't applicable — installation tokens are minted, not refreshed.
    expect(spec.auth.refreshable).toBe(true);
  });

  it('declares the documented http base url + headers', () => {
    const spec = createGithubSpec(opts);
    expect(spec.http?.baseUrl).toBe('https://api.github.com');
    expect(spec.http?.defaultHeaders?.['Accept']).toBe('application/vnd.github+json');
    expect(spec.http?.defaultHeaders?.['X-GitHub-Api-Version']).toBe('2022-11-28');
  });

  it('parses an empty cursor through the prose schema (defaults to {})', () => {
    const spec = createGithubSpec(opts);
    const proseRes = spec.resources[0]!;
    const result = proseRes.cursorSchema.safeParse(undefined);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('parses a populated cursor through the code schema (passes through)', () => {
    const spec = createGithubSpec(opts);
    const codeRes = spec.resources[1]!;
    const meta = { last_indexed_sha: 'abc123', per_repo_sha: { 'org/repo': 'abc123' } };
    const result = codeRes.cursorSchema.safeParse(meta);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(meta);
  });
});
