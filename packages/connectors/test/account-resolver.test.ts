/**
 * Account-resolver unit tests. SQL is mocked via the same tagged-template
 * stub style as `customer-accounts.test.ts` — we assert on the tier of
 * heuristic that fired without spinning up Postgres.
 *
 * The resolver's contract:
 *   - UUID input bypasses every text-match tier and verifies org scope.
 *   - text input walks display_name → alias → domain → prefix.
 *   - Empty input throws structured holoError.
 */
import { describe, it, expect } from 'vitest';
import { resolveCustomerAccount } from '../src/shared/account-resolver';

const ORG = '00000000-0000-0000-0000-000000000001';

interface MockResponse {
  rows: unknown[];
}

function mockSql(responses: ReadonlyArray<MockResponse>) {
  const calls: string[] = [];
  let idx = 0;
  const tagFn = (firstArg: unknown) => {
    const isTemplate =
      Array.isArray(firstArg) && Object.prototype.hasOwnProperty.call(firstArg, 'raw');
    if (!isTemplate) return { fragment: true };
    const strings = firstArg as TemplateStringsArray;
    calls.push(strings.join('?'));
    const response = responses[idx++];
    return Promise.resolve(response?.rows ?? []);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = tagFn as any;
  return { sql: fn, calls };
}

describe('resolveCustomerAccount — UUID fast path', () => {
  it('returns the row on a UUID hit with matchedBy = uuid', async () => {
    const { sql, calls } = mockSql([
      {
        rows: [
          {
            id: '11111111-1111-1111-1111-111111111111',
            display_name: 'Skello',
            primary_domain: 'skello.io',
            domains: ['skello.io'],
            aliases: ['Skello SA'],
          },
        ],
      },
    ]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.match?.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(result.match?.matchedBy).toBe('uuid');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/organization_id = \?/);
    expect(calls[0]).toMatch(/AND id = \?/);
  });

  it('returns no match when the UUID exists in a different org', async () => {
    // The stub returns an empty rows array; the resolver treats org-scoped
    // miss as "no access". This is what wires the REST 403 mapping.
    const { sql } = mockSql([{ rows: [] }]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: '11111111-1111-1111-1111-111111111111',
    });
    expect(result.match).toBeNull();
    expect(result.candidates).toEqual([]);
  });
});

describe('resolveCustomerAccount — text matching tiers', () => {
  it('matches exact display_name with matchedBy = display_name', async () => {
    const { sql, calls } = mockSql([
      {
        rows: [
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            display_name: 'Skello',
            primary_domain: 'skello.io',
            domains: [],
            aliases: [],
          },
        ],
      },
    ]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: 'Skello',
    });
    expect(result.match?.matchedBy).toBe('display_name');
    // Only one query fired — we short-circuit before the alias / domain
    // / prefix tiers.
    expect(calls).toHaveLength(1);
  });

  it('falls through to alias when display_name misses', async () => {
    const { sql, calls } = mockSql([
      { rows: [] },
      {
        rows: [
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            display_name: 'Skello',
            primary_domain: null,
            domains: [],
            aliases: ['Skello SA'],
          },
        ],
      },
    ]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: 'Skello SA',
    });
    expect(result.match?.matchedBy).toBe('alias');
    expect(calls).toHaveLength(2);
  });

  it('falls through to domain when query looks like a domain', async () => {
    // No display-name match, no alias match, but the heuristic recognises
    // "acme.io" as a domain and runs the third tier.
    const { sql, calls } = mockSql([
      { rows: [] },
      { rows: [] },
      {
        rows: [
          {
            id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
            display_name: 'Acme',
            primary_domain: 'acme.io',
            domains: ['acme.io'],
            aliases: [],
          },
        ],
      },
    ]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: 'acme.io',
    });
    expect(result.match?.matchedBy).toBe('domain');
    expect(calls).toHaveLength(3);
  });

  it('skips the domain tier when query has whitespace', async () => {
    // "Acme Corp" doesn't look like a domain — the resolver MUST skip the
    // domain query to avoid pulling text-typed names through a domain
    // index. Falls through to prefix.
    const { sql, calls } = mockSql([{ rows: [] }, { rows: [] }, { rows: [] }]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: 'Acme Corp',
    });
    expect(result.match).toBeNull();
    // 3 calls = display + alias + prefix; domain skipped.
    expect(calls).toHaveLength(3);
  });

  it('returns multiple candidates when several rows tie in a tier', async () => {
    // Disambiguation UI uses `candidates.length > 1` to render a picker.
    const { sql } = mockSql([
      {
        rows: [
          {
            id: 'cccc',
            display_name: 'Skello',
            primary_domain: null,
            domains: [],
            aliases: [],
          },
          {
            id: 'dddd',
            display_name: 'Skello',
            primary_domain: null,
            domains: [],
            aliases: [],
          },
        ],
      },
    ]);
    const result = await resolveCustomerAccount(sql, {
      organizationId: ORG,
      query: 'Skello',
    });
    expect(result.candidates).toHaveLength(2);
    expect(result.match?.id).toBe('cccc');
  });
});

describe('resolveCustomerAccount — edge cases', () => {
  it('throws on empty query (after trimming)', async () => {
    const { sql } = mockSql([]);
    await expect(
      resolveCustomerAccount(sql, { organizationId: ORG, query: '   ' }),
    ).rejects.toThrow();
  });
});
