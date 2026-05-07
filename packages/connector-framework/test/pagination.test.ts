import { describe, it, expect } from 'vitest';
import { buildPaginator, parseLinkHeader } from '../src/pagination/paginate';
import type { HttpClient, RequestOptions } from '../src/http/types';

function fakeClient(pages: Array<{ path: string; query?: Record<string, unknown>; body: unknown }>): {
  client: HttpClient;
  calls: Array<{ path: string; query: RequestOptions['query'] }>;
} {
  const calls: Array<{ path: string; query: RequestOptions['query'] }> = [];
  let i = 0;
  const client: HttpClient = {
    async get(path, opts) {
      calls.push({ path, query: opts?.query });
      const next = pages[i];
      i += 1;
      if (!next) throw new Error(`no canned page for call ${i}`);
      return next.body as never;
    },
    async post() {
      throw new Error('not used');
    },
    async request() {
      throw new Error('not used');
    },
  };
  return { client, calls };
}

describe('cursor pagination', () => {
  it('walks until nextCursor is null', async () => {
    const { client, calls } = fakeClient([
      { path: '/items', body: { items: [1, 2], next: 'a' } },
      { path: '/items', body: { items: [3, 4], next: 'b' } },
      { path: '/items', body: { items: [5], next: null } },
    ]);
    const paginator = buildPaginator({ client });
    const collected: number[] = [];
    for await (const page of paginator.cursor<
      { items: number[]; next: string | null },
      number
    >('/items', {
      items: (p) => p.items,
      nextCursor: (p) => p.next,
    })) {
      collected.push(...page);
    }
    expect(collected).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.query?.cursor).toBeUndefined();
    expect(calls[1]!.query?.cursor).toBe('a');
    expect(calls[2]!.query?.cursor).toBe('b');
  });

  it('respects baseQuery on every page', async () => {
    const { client, calls } = fakeClient([
      { path: '/x', body: { items: [], next: null } },
    ]);
    const paginator = buildPaginator({ client });
    for await (const _ of paginator.cursor<{ items: never[]; next: null }, never>('/x', {
      items: (p) => p.items,
      nextCursor: (p) => p.next,
      baseQuery: { since: '2026-01-01' },
    })) {
      /* drain */
    }
    expect(calls[0]!.query?.['since']).toBe('2026-01-01');
  });
});

describe('page pagination', () => {
  it('increments until items() is empty', async () => {
    const { client, calls } = fakeClient([
      { path: '/r', body: { items: [1, 2] } },
      { path: '/r', body: { items: [3] } },
      { path: '/r', body: { items: [] } },
    ]);
    const paginator = buildPaginator({ client });
    const all: number[] = [];
    for await (const page of paginator.page<{ items: number[] }, number>('/r', {
      items: (p) => p.items,
    })) {
      all.push(...page);
    }
    expect(all).toEqual([1, 2, 3]);
    expect(calls).toHaveLength(3);
    expect(calls[0]!.query?.page).toBe(1);
    expect(calls[1]!.query?.page).toBe(2);
    expect(calls[2]!.query?.page).toBe(3);
  });

  it('respects custom hasMore predicate', async () => {
    const { client, calls } = fakeClient([
      { path: '/r', body: { results: [1, 2], has_next: true } },
      { path: '/r', body: { results: [3], has_next: false } },
    ]);
    const paginator = buildPaginator({ client });
    for await (const _ of paginator.page<{ results: number[]; has_next: boolean }, number>(
      '/r',
      {
        items: (p) => p.results,
        hasMore: (p) => p.has_next,
      },
    )) {
      /* drain */
    }
    expect(calls).toHaveLength(2);
  });
});

describe('parseLinkHeader', () => {
  it('parses GitHub-style Link header', () => {
    const links = parseLinkHeader(
      '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=10>; rel="last"',
    );
    expect(links['next']).toBe('https://api.github.com/x?page=2');
    expect(links['last']).toBe('https://api.github.com/x?page=10');
  });

  it('returns empty object on null', () => {
    expect(parseLinkHeader(null)).toEqual({});
  });
});
