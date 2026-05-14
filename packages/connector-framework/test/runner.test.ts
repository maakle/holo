import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { defineConnector } from '../src/define-connector';
import { apiKey } from '../src/auth/api-key';
import { oauth2 } from '../src/auth/oauth2';
import { runConnectorSync } from '../src/runtime/runner';
import type { ChunkRecord, RuntimeStores } from '../src/runtime/stores';
import type { ConnectorTokens } from '../src/types';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: { existingHashes?: string[]; cursors?: Record<string, unknown> }): {
  stores: RuntimeStores;
  enqueued: ChunkRecord[];
  savedCursors: Array<{ resourceId: string; cursor: unknown }>;
} {
  const enqueued: ChunkRecord[] = [];
  const savedCursors: Array<{ resourceId: string; cursor: unknown }> = [];
  const cursors = { ...(initial?.cursors ?? {}) };
  return {
    enqueued,
    savedCursors,
    stores: {
      async loadTokens() {
        return { accessToken: 'k' };
      },
      async loadCursor({ resourceId }) {
        return cursors[resourceId];
      },
      async saveCursor({ resourceId, cursor }) {
        cursors[resourceId] = cursor;
        savedCursors.push({ resourceId, cursor });
      },
      async loadExistingHashes() {
        return new Set(initial?.existingHashes ?? []);
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
    },
  };
}

describe('runConnectorSync', () => {
  it('runs a single resource end-to-end and persists cursor', async () => {
    const fetchImpl = (async (url: unknown) => {
      const u = new URL(String(url));
      if (u.searchParams.get('cursor') === 'p2') {
        return jsonResponse({ items: [{ id: 'c', body: 'cccc' }], next: null });
      }
      return jsonResponse({
        items: [
          { id: 'a', body: 'aaaa' },
          { id: 'b', body: 'bbbb' },
        ],
        next: 'p2',
      });
    }) as unknown as typeof fetch;

    const spec = defineConnector({
      id: 'demo',
      displayName: 'Demo',
      sync: { intervalMs: 60_000 },
      auth: apiKey(),
      http: { baseUrl: 'https://api.demo.com' },
      async testConnection() {
        return { externalId: 'x', name: 'X' };
      },
      resources: [
        {
          id: 'items',
          cursorSchema: z.object({ updatedAt: z.string().optional() }).default({}),
          async sync(ctx) {
            for await (const page of ctx.paginate.cursor<
              { items: Array<{ id: string; body: string }>; next: string | null },
              { id: string; body: string }
            >('/items', {
              items: (p) => p.items,
              nextCursor: (p) => p.next,
            })) {
              for (const item of page) {
                await ctx.upsert({
                  externalId: item.id,
                  kind: 'demo-item',
                  content: item.body,
                  metadata: { id: item.id },
                  aclSubjects: [],
                });
              }
            }
            return { updatedAt: '2026-05-07T00:00:00Z' };
          },
        },
      ],
    });

    const { stores, enqueued, savedCursors } = makeStores();
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBe(3);
    expect(enqueued).toHaveLength(3);
    expect(enqueued[0]!.sourceArtifactId).toBe('demo-item:a');
    expect(enqueued[0]!.provider).toBe('demo');
    expect(enqueued[0]!.organizationId).toBe('org-1');
    expect(savedCursors.at(-1)).toEqual({
      resourceId: 'items',
      cursor: { updatedAt: '2026-05-07T00:00:00Z' },
    });
    expect(result.cursorPatch['items']).toEqual({ updatedAt: '2026-05-07T00:00:00Z' });
  });

  it('dedupes against existingHashes', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ items: [{ id: 'a', body: 'same' }], next: null })) as unknown as typeof fetch;

    const spec = defineConnector({
      id: 'demo',
      displayName: 'Demo',
      sync: { intervalMs: 60_000 },
      auth: apiKey(),
      http: { baseUrl: 'https://x' },
      async testConnection() {
        return { externalId: 'x', name: 'X' };
      },
      resources: [
        {
          id: 'items',
          cursorSchema: z.object({}).default({}),
          async sync(ctx) {
            for await (const page of ctx.paginate.cursor<
              { items: Array<{ id: string; body: string }>; next: string | null },
              { id: string; body: string }
            >('/x', {
              items: (p) => p.items,
              nextCursor: (p) => p.next,
            })) {
              for (const item of page) {
                await ctx.upsert({
                  externalId: item.id,
                  kind: 'k',
                  content: item.body,
                  metadata: {},
                  aclSubjects: [],
                });
              }
            }
            return {};
          },
        },
      ],
    });

    // Pre-populate the existing-hashes Set with the hash for ('k', 'same').
    const { createHash } = await import('node:crypto');
    const existing = createHash('sha256').update('k:same').digest('hex');

    const { stores, enqueued } = makeStores({ existingHashes: [existing] });
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(result.artifactCount).toBe(0);
    expect(enqueued).toHaveLength(0);
    // Dedup hits show up on the breakdown so the dashboard can surface
    // "we already had this content" runs distinctly from "no new chunks".
    expect(result.breakdown).toEqual({ k: { new: 0, deduped: 1 } });
  });

  it('tracks per-kind new and deduped counts on the breakdown', async () => {
    // One page, four items: two of kind 'a' (one fresh, one repeat-of-itself),
    // two of kind 'b' (both fresh, distinct content). The repeat-of-itself
    // mirrors the real-world case where a connector emits the same chunk
    // twice within a single sync (e.g. a comment quoted from another
    // thread) — the second emission should count as a dedup, not a new.
    const fetchImpl = (async () =>
      jsonResponse({
        items: [
          { id: 'a1', kind: 'a', body: 'alpha' },
          { id: 'a2', kind: 'a', body: 'alpha' }, // same content as a1 → dedup
          { id: 'b1', kind: 'b', body: 'one' },
          { id: 'b2', kind: 'b', body: 'two' },
        ],
        next: null,
      })) as unknown as typeof fetch;

    const spec = defineConnector({
      id: 'demo',
      displayName: 'Demo',
      sync: { intervalMs: 60_000 },
      auth: apiKey(),
      http: { baseUrl: 'https://x' },
      async testConnection() {
        return { externalId: 'x', name: 'X' };
      },
      resources: [
        {
          id: 'items',
          cursorSchema: z.object({}).default({}),
          async sync(ctx) {
            for await (const page of ctx.paginate.cursor<
              { items: Array<{ id: string; kind: string; body: string }>; next: string | null },
              { id: string; kind: string; body: string }
            >('/x', {
              items: (p) => p.items,
              nextCursor: (p) => p.next,
            })) {
              for (const item of page) {
                await ctx.upsert({
                  externalId: item.id,
                  kind: item.kind,
                  content: item.body,
                  metadata: {},
                  aclSubjects: [],
                });
              }
            }
            return {};
          },
        },
      ],
    });

    const { stores, enqueued } = makeStores();
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(result.artifactCount).toBe(3);
    expect(enqueued).toHaveLength(3);
    expect(result.breakdown).toEqual({
      a: { new: 1, deduped: 1 },
      b: { new: 2, deduped: 0 },
    });
  });

  it('rejects a spec with duplicate resource ids', () => {
    expect(() =>
      defineConnector({
        id: 'demo',
        displayName: 'Demo',
        sync: { intervalMs: 60_000 },
        auth: apiKey(),
        async testConnection() {
          return { externalId: '', name: '' };
        },
        resources: [
          {
            id: 'dup',
            cursorSchema: z.object({}).default({}),
            async sync() {
              return {};
            },
          },
          {
            id: 'dup',
            cursorSchema: z.object({}).default({}),
            async sync() {
              return {};
            },
          },
        ],
      }),
    ).toThrow(/duplicate resource id/);
  });

  it('runs multiple resources in declaration order', async () => {
    const fetchImpl = (async (url: unknown) => {
      const u = new URL(String(url));
      if (u.pathname === '/users') {
        return jsonResponse({ items: [{ id: 'u1', body: 'alice' }], next: null });
      }
      return jsonResponse({ items: [{ id: 'i1', body: 'open' }], next: null });
    }) as unknown as typeof fetch;

    const order: string[] = [];
    const spec = defineConnector({
      id: 'demo',
      displayName: 'Demo',
      sync: { intervalMs: 60_000 },
      auth: apiKey(),
      http: { baseUrl: 'https://x' },
      async testConnection() {
        return { externalId: '', name: '' };
      },
      resources: [
        {
          id: 'users',
          cursorSchema: z.object({}).default({}),
          async sync(ctx) {
            order.push('users');
            for await (const page of ctx.paginate.cursor<
              { items: Array<{ id: string; body: string }>; next: string | null },
              { id: string; body: string }
            >('/users', {
              items: (p) => p.items,
              nextCursor: (p) => p.next,
            })) {
              for (const i of page) {
                await ctx.upsert({
                  externalId: i.id,
                  kind: 'user',
                  content: i.body,
                  metadata: {},
                  aclSubjects: [],
                });
              }
            }
            return {};
          },
        },
        {
          id: 'issues',
          cursorSchema: z.object({}).default({}),
          async sync(ctx) {
            order.push('issues');
            for await (const page of ctx.paginate.cursor<
              { items: Array<{ id: string; body: string }>; next: string | null },
              { id: string; body: string }
            >('/issues', {
              items: (p) => p.items,
              nextCursor: (p) => p.next,
            })) {
              for (const i of page) {
                await ctx.upsert({
                  externalId: i.id,
                  kind: 'issue',
                  content: i.body,
                  metadata: {},
                  aclSubjects: [],
                });
              }
            }
            return {};
          },
        },
      ],
    });

    const { stores, enqueued } = makeStores();
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(order).toEqual(['users', 'issues']);
    expect(result.artifactCount).toBe(2);
    expect(enqueued.map((c) => c.kind)).toEqual(['user', 'issue']);
  });

  describe('token refresh', () => {
    /**
     * Spec helper for refresh tests. Uses real oauth2() auth so we exercise
     * the full strategy plumbing rather than a hand-rolled mock.
     */
    function makeRefreshableSpec(tokenEndpointResponses: ReadonlyArray<unknown>) {
      let i = 0;
      const tokenFetch: typeof fetch = (async () => {
        const body = tokenEndpointResponses[i++];
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      return defineConnector({
        id: 'demo-refresh',
        displayName: 'Demo Refreshable',
        sync: { intervalMs: 60_000 },
        auth: oauth2({
          clientId: 'cid',
          clientSecret: 'csec',
          authorizeUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: ['read'],
          refreshable: true,
          fetchImpl: tokenFetch,
        }),
        http: { baseUrl: 'https://api.example.com' },
        async testConnection() {
          return { externalId: 'x', name: 'X' };
        },
        resources: [
          {
            id: 'noop',
            cursorSchema: z.record(z.string(), z.unknown()).default({}),
            async sync(_ctx) {
              return {};
            },
          },
        ],
      });
    }

    function refreshableStoresFor(initial: ConnectorTokens): {
      stores: RuntimeStores;
      saveTokens: ReturnType<typeof vi.fn>;
      loadTokens: ReturnType<typeof vi.fn>;
      withAuthLockCalls: { count: number };
      current: { tokens: ConnectorTokens };
    } {
      const current = { tokens: initial };
      const withAuthLockCalls = { count: 0 };
      const loadTokens = vi.fn(async () => current.tokens);
      const saveTokens = vi.fn(async ({ tokens }: { tokens: ConnectorTokens }) => {
        current.tokens = tokens;
      });
      return {
        current,
        loadTokens,
        saveTokens,
        withAuthLockCalls,
        stores: {
          loadTokens,
          saveTokens,
          async withAuthLock(_input, fn) {
            withAuthLockCalls.count += 1;
            return fn();
          },
          async loadCursor() {
            return undefined;
          },
          async saveCursor() {
            // no-op
          },
          async loadExistingHashes() {
            return new Set<string>();
          },
          async enqueueChunks() {
            // no-op
          },
        },
      };
    }

    it('refreshes when access token is near expiry and persists rotated tokens', async () => {
      const spec = makeRefreshableSpec([
        {
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
        },
      ]);
      const { stores, saveTokens, withAuthLockCalls, current } = refreshableStoresFor({
        accessToken: 'stale',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 60_000), // 1 min — well inside skew
      });

      await runConnectorSync({
        spec,
        stores,
        organizationId: 'org-1',
        sourceId: 'src-1',
      });

      expect(withAuthLockCalls.count).toBe(1);
      expect(saveTokens).toHaveBeenCalledOnce();
      expect(current.tokens.accessToken).toBe('new-access');
      expect(current.tokens.refreshToken).toBe('new-refresh');
    });

    it('does not refresh when access token still has plenty of life', async () => {
      const spec = makeRefreshableSpec([]);
      const { stores, saveTokens, withAuthLockCalls } = refreshableStoresFor({
        accessToken: 'fresh',
        refreshToken: 'rt',
        expiresAt: new Date(Date.now() + 60 * 60_000), // 1h — far outside skew
      });

      await runConnectorSync({
        spec,
        stores,
        organizationId: 'org-1',
        sourceId: 'src-1',
      });

      expect(withAuthLockCalls.count).toBe(0);
      expect(saveTokens).not.toHaveBeenCalled();
    });

    it('skips refresh if a concurrent run refreshed inside the lock', async () => {
      // Token endpoint should NOT be called: by the time fn() runs, the
      // re-read inside the lock returns a non-expiring token.
      const tokenFetch = vi.fn();
      const spec = defineConnector({
        id: 'demo-refresh',
        displayName: 'Demo Refreshable',
        sync: { intervalMs: 60_000 },
        auth: oauth2({
          clientId: 'cid',
          clientSecret: 'csec',
          authorizeUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: ['read'],
          refreshable: true,
          fetchImpl: tokenFetch as unknown as typeof fetch,
        }),
        http: { baseUrl: 'https://api.example.com' },
        async testConnection() {
          return { externalId: 'x', name: 'X' };
        },
        resources: [
          {
            id: 'noop',
            cursorSchema: z.record(z.string(), z.unknown()).default({}),
            async sync() {
              return {};
            },
          },
        ],
      });

      const initial: ConnectorTokens = {
        accessToken: 'stale',
        refreshToken: 'old-refresh',
        expiresAt: new Date(Date.now() + 60_000), // expiring soon — triggers lock
      };
      const fresh: ConnectorTokens = {
        accessToken: 'already-refreshed',
        refreshToken: 'new-refresh',
        expiresAt: new Date(Date.now() + 60 * 60_000),
      };

      let calls = 0;
      const stores: RuntimeStores = {
        async loadTokens() {
          calls += 1;
          // First call (outside the lock): old token, near expiry → triggers refresh path.
          // Second call (inside the lock): a concurrent worker refreshed; not near expiry.
          return calls === 1 ? initial : fresh;
        },
        async saveTokens() {
          // would only be called if we actually refresh
        },
        async withAuthLock(_input, fn) {
          return fn();
        },
        async loadCursor() {
          return undefined;
        },
        async saveCursor() {},
        async loadExistingHashes() {
          return new Set();
        },
        async enqueueChunks() {},
      };

      await runConnectorSync({
        spec,
        stores,
        organizationId: 'org-1',
        sourceId: 'src-1',
      });

      expect(tokenFetch).not.toHaveBeenCalled();
    });

    it('does not refresh when the strategy is not refreshable, even if expiresAt is past', async () => {
      const apiKeyStores = (() => {
        const tokens: ConnectorTokens = {
          accessToken: 'k',
          expiresAt: new Date(Date.now() + 60_000),
        };
        const loadTokens = vi.fn(async () => tokens);
        const saveTokens = vi.fn(async () => {});
        return {
          loadTokens,
          saveTokens,
          stores: {
            loadTokens,
            saveTokens,
            async loadCursor() {
              return undefined;
            },
            async saveCursor() {},
            async loadExistingHashes() {
              return new Set<string>();
            },
            async enqueueChunks() {},
          } satisfies RuntimeStores,
        };
      })();

      const spec = defineConnector({
        id: 'demo',
        displayName: 'Demo',
        sync: { intervalMs: 60_000 },
        auth: apiKey(),
        http: { baseUrl: 'https://api.example.com' },
        async testConnection() {
          return { externalId: 'x', name: 'X' };
        },
        resources: [
          {
            id: 'noop',
            cursorSchema: z.record(z.string(), z.unknown()).default({}),
            async sync() {
              return {};
            },
          },
        ],
      });

      await runConnectorSync({
        spec,
        stores: apiKeyStores.stores,
        organizationId: 'org-1',
        sourceId: 'src-1',
      });

      expect(apiKeyStores.saveTokens).not.toHaveBeenCalled();
    });
  });

  describe('url invariant', () => {
    // The agent surfaces (Slack bot, web chat) render citations as clickable
    // deep links sourced from `metadata.url` (or `metadata.permalink` for
    // legacy chunkers). When a chunker forgets, citations to that content
    // still appear but lead nowhere. We warn once per `(provider, kind)`
    // per sync so the gap is visible to operators without spamming.

    function makeUrlSpec(itemMetadata: (id: string) => Record<string, unknown>): {
      spec: ReturnType<typeof defineConnector>;
      fetchImpl: typeof fetch;
    } {
      const fetchImpl = (async () =>
        jsonResponse({ items: [{ id: 'a' }, { id: 'b' }], next: null })) as unknown as typeof fetch;
      const spec = defineConnector({
        id: 'demo',
        displayName: 'Demo',
        sync: { intervalMs: 60_000 },
        auth: apiKey(),
        http: { baseUrl: 'https://x' },
        async testConnection() {
          return { externalId: 'x', name: 'X' };
        },
        resources: [
          {
            id: 'items',
            cursorSchema: z.object({}).default({}),
            async sync(ctx) {
              for await (const page of ctx.paginate.cursor<
                { items: Array<{ id: string }>; next: string | null },
                { id: string }
              >('/x', {
                items: (p) => p.items,
                nextCursor: (p) => p.next,
              })) {
                for (const item of page) {
                  await ctx.upsert({
                    externalId: item.id,
                    kind: 'demo-thing',
                    content: `body-${item.id}`,
                    metadata: itemMetadata(item.id),
                    aclSubjects: [],
                  });
                }
              }
              return {};
            },
          },
        ],
      });
      return { spec, fetchImpl };
    }

    it('warns once per kind when chunks lack metadata.url and metadata.permalink', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeUrlSpec(() => ({}));
      const { stores } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

      // Two chunks emitted of kind 'demo-thing', but only one warning.
      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes("kind 'demo-thing'") && m.includes('metadata.url'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('demo');
      warn.mockRestore();
    });

    it('does not warn when metadata.url is a non-empty string', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeUrlSpec((id) => ({ url: `https://example.com/${id}` }));
      const { stores } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes("kind 'demo-thing'") && m.includes('metadata.url'));
      expect(warnings).toHaveLength(0);
      warn.mockRestore();
    });

    it('accepts metadata.permalink as a legacy alias for url', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeUrlSpec((id) => ({
        permalink: `https://slack.com/archives/C1/p${id}`,
      }));
      const { stores } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes("kind 'demo-thing'") && m.includes('metadata.url'));
      expect(warnings).toHaveLength(0);
      warn.mockRestore();
    });

    it('warns when url is present but is an empty string (truthiness check)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeUrlSpec(() => ({ url: '' }));
      const { stores } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'o', sourceId: 's', fetchImpl });

      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes("kind 'demo-thing'") && m.includes('metadata.url'));
      expect(warnings).toHaveLength(1);
      warn.mockRestore();
    });
  });

  describe('acl invariant', () => {
    // Holo's Files API + RAG retrieval filter rows by `acl_subjects && userSubjects`.
    // Every user holds `org:${orgId}` as a subject, so a chunk without that
    // subject is invisible across every surface. The framework auto-injects
    // it and warns once per `(provider, kind)` per sync — connector authors
    // can't silently regress this invariant. (See packages/connectors/README.md.)

    function makeAclSpec(subjectsFor: (id: string) => string[]): {
      spec: ReturnType<typeof defineConnector>;
      fetchImpl: typeof fetch;
    } {
      const fetchImpl = (async () =>
        jsonResponse({ items: [{ id: 'a' }, { id: 'b' }], next: null })) as unknown as typeof fetch;
      const spec = defineConnector({
        id: 'demo',
        displayName: 'Demo',
        sync: { intervalMs: 60_000 },
        auth: apiKey(),
        http: { baseUrl: 'https://x' },
        async testConnection() {
          return { externalId: 'x', name: 'X' };
        },
        resources: [
          {
            id: 'items',
            cursorSchema: z.object({}).default({}),
            async sync(ctx) {
              for await (const page of ctx.paginate.cursor<
                { items: Array<{ id: string }>; next: string | null },
                { id: string }
              >('/x', {
                items: (p) => p.items,
                nextCursor: (p) => p.next,
              })) {
                for (const item of page) {
                  await ctx.upsert({
                    externalId: item.id,
                    kind: 'demo-thing',
                    content: `body-${item.id}`,
                    metadata: { url: `https://example.com/${item.id}` },
                    aclSubjects: subjectsFor(item.id),
                  });
                }
              }
              return {};
            },
          },
        ],
      });
      return { spec, fetchImpl };
    }

    it('auto-injects org:${orgId} when missing, and warns once per kind', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeAclSpec(() => ['demo:tenant:42']);
      const { stores, enqueued } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'org-1', sourceId: 's', fetchImpl });

      // Both chunks enqueued have org subject injected.
      expect(enqueued).toHaveLength(2);
      for (const row of enqueued) {
        expect(row.aclSubjects).toContain('org:org-1');
        expect(row.aclSubjects).toContain('demo:tenant:42');
      }
      // Exactly one warning despite two emissions.
      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes('aclSubjects') && m.includes("kind 'demo-thing'"));
      expect(warnings).toHaveLength(1);
      warn.mockRestore();
    });

    it('does not warn when chunker already emits org:${orgId}', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { spec, fetchImpl } = makeAclSpec(() => ['org:org-1', 'demo:tenant:42']);
      const { stores, enqueued } = makeStores();
      await runConnectorSync({ spec, stores, organizationId: 'org-1', sourceId: 's', fetchImpl });

      expect(enqueued).toHaveLength(2);
      for (const row of enqueued) {
        expect(row.aclSubjects).toEqual(['org:org-1', 'demo:tenant:42']);
      }
      const warnings = warn.mock.calls
        .map((args) => String(args[0]))
        .filter((m) => m.includes('aclSubjects'));
      expect(warnings).toHaveLength(0);
      warn.mockRestore();
    });
  });
});
