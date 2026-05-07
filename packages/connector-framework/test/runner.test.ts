import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { defineConnector } from '../src/define-connector';
import { apiKey } from '../src/auth/api-key';
import { runConnectorSync } from '../src/runtime/runner';
import type { ChunkRecord, RuntimeStores } from '../src/runtime/stores';

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
    expect(enqueued[0]!.sourceArtifactId).toBe('demo-demo-item:a');
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
  });

  it('rejects a spec with duplicate resource ids', () => {
    expect(() =>
      defineConnector({
        id: 'demo',
        displayName: 'Demo',
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
});
