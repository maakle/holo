import { describe, it, expect } from 'vitest';
import { runConnectorSync, type ChunkRecord, type RuntimeStores } from '@holo/connector-framework';
import { createSalesforceSpec } from '../src/salesforce/index';

const INSTANCE_URL = 'https://acme.my.salesforce.com';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeStores(initial?: {
  existingHashes?: string[];
  cursors?: Record<string, unknown>;
  sourceMetadata?: Record<string, unknown>;
}): {
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
        return {
          accessToken: 'sf_access_token',
          refreshToken: 'sf_refresh_token',
          expiresAt: new Date(Date.now() + 60 * 60_000),
        };
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
      async loadSourceMetadata() {
        return initial?.sourceMetadata ?? { instanceUrl: INSTANCE_URL };
      },
      async enqueueChunks({ chunks }) {
        enqueued.push(...chunks);
      },
    },
  };
}

interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
  headers: Headers;
  query: URLSearchParams;
}

function makeFetch(
  responder: (req: CapturedRequest) => Response,
): { fetchImpl: typeof fetch; calls: CapturedRequest[] } {
  const calls: CapturedRequest[] = [];
  const fn = (async (url: unknown, init: RequestInit) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? {});
    let body: unknown = null;
    if (typeof init.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const parsed = new URL(String(url));
    const captured: CapturedRequest = {
      url: String(url),
      method: (init.method ?? 'GET').toUpperCase(),
      body,
      headers,
      query: parsed.searchParams,
    };
    calls.push(captured);
    return responder(captured);
  }) as unknown as typeof fetch;
  return { fetchImpl: fn, calls };
}

/**
 * Default empty-activity responder used by tests that don't care about
 * the activity-timeline plumbing — every Task / Event / Note SOQL returns
 * zero rows.
 */
function emptyActivitiesResponder(req: CapturedRequest): Response | null {
  const q = req.query.get('q') ?? '';
  if (
    /\bFROM\s+(Task|Event|ContentDocumentLink|ContentNote)\b/i.test(q)
  ) {
    return jsonResponse({ totalSize: 0, done: true, records: [] });
  }
  return null;
}

describe('createSalesforceSpec', () => {
  it('declares 3 resources (accounts, contacts, opportunities) in declaration order', () => {
    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's' });
    expect(spec.id).toBe('salesforce');
    expect(spec.resources).toHaveLength(3);
    expect(spec.resources.map((r) => r.id)).toEqual(['accounts', 'contacts', 'opportunities']);
    expect(spec.auth.kind).toBe('oauth2');
    expect(spec.auth.refreshable).toBe(true);
  });

  it('uses login.salesforce.com by default for the OAuth endpoints', () => {
    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's' });
    const authorizeUrl = spec.auth.buildAuthorizeUrl!({
      redirectUri: 'https://app.holo.dev/cb',
      state: 'st',
    });
    expect(authorizeUrl).toContain('https://login.salesforce.com/services/oauth2/authorize');
    expect(authorizeUrl).toContain('client_id=c');
    expect(authorizeUrl).toContain('scope=api');
  });
});

describe('Salesforce sync — full sweep with no activities', () => {
  it('iterates all three resources via SOQL and emits one chunk per record kind', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const empty = emptyActivitiesResponder(req);
      if (empty) return empty;
      const q = req.query.get('q') ?? '';
      if (q.includes('FROM Account')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '001',
              Name: 'Acme',
              Website: 'https://acme.example',
              Industry: 'Software',
              CreatedDate: '2026-04-01T00:00:00.000+0000',
              SystemModstamp: '2026-05-03T10:00:00.000+0000',
            },
          ],
        });
      }
      if (q.includes('FROM Contact')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '003',
              FirstName: 'Ada',
              LastName: 'Lovelace',
              Email: 'ada@acme.example',
              CreatedDate: '2026-04-01T00:00:00.000+0000',
              SystemModstamp: '2026-05-01T10:00:00.000+0000',
            },
          ],
        });
      }
      if (q.includes('FROM Opportunity')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '006',
              Name: 'Acme — Q4 Renewal',
              StageName: 'Negotiation',
              Amount: 50000,
              CreatedDate: '2026-04-01T00:00:00.000+0000',
              SystemModstamp: '2026-05-02T10:00:00.000+0000',
            },
          ],
        });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's', fetchImpl });
    const { stores, enqueued, savedCursors } = makeStores();
    const result = await runConnectorSync({
      spec,
      stores,
      organizationId: 'org-1',
      sourceId: 'src-1',
      fetchImpl,
    });

    expect(result.artifactCount).toBeGreaterThanOrEqual(3);
    const kinds = new Set(enqueued.map((c) => c.kind));
    expect(kinds.has('salesforce-account')).toBe(true);
    expect(kinds.has('salesforce-contact')).toBe(true);
    expect(kinds.has('salesforce-opportunity')).toBe(true);

    const artifactIds = new Set(enqueued.map((c) => c.sourceArtifactId));
    expect(artifactIds.has('salesforce-account:001')).toBe(true);
    expect(artifactIds.has('salesforce-contact:003')).toBe(true);
    expect(artifactIds.has('salesforce-opportunity:006')).toBe(true);

    // Per-resource cursors saved independently using SystemModstamp.
    const byResource = new Map(savedCursors.map((s) => [s.resourceId, s.cursor]));
    expect(byResource.get('accounts')).toEqual({
      updatedAt: '2026-05-03T10:00:00.000+0000',
    });
    expect(byResource.get('contacts')).toEqual({
      updatedAt: '2026-05-01T10:00:00.000+0000',
    });
    expect(byResource.get('opportunities')).toEqual({
      updatedAt: '2026-05-02T10:00:00.000+0000',
    });

    // Every API call hits the per-org instance host, not the placeholder
    // baseUrl on the spec.
    for (const c of calls) {
      expect(c.url.startsWith(INSTANCE_URL)).toBe(true);
    }
  });
});

describe('Salesforce sync — incremental adds SystemModstamp filter', () => {
  it('reuses the persisted cursor and emits a SOQL WHERE clause', async () => {
    const { fetchImpl, calls } = makeFetch((req) => {
      const empty = emptyActivitiesResponder(req);
      if (empty) return empty;
      const q = req.query.get('q') ?? '';
      if (q.includes('FROM Contact')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: 'c2',
              FirstName: 'Grace',
              LastName: 'Hopper',
              CreatedDate: '2026-05-04T00:00:00.000+0000',
              SystemModstamp: '2026-05-04T10:00:00.000+0000',
            },
          ],
        });
      }
      return jsonResponse({ totalSize: 0, done: true, records: [] });
    });

    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's', fetchImpl });
    const { stores } = makeStores({
      cursors: { contacts: { updatedAt: '2026-05-01T00:00:00.000+0000' } },
    });
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const contactQuery = calls.find(
      (c) => (c.query.get('q') ?? '').includes('FROM Contact'),
    );
    expect(contactQuery).toBeDefined();
    expect(contactQuery!.query.get('q')).toContain(
      "WHERE SystemModstamp > 2026-05-01T00:00:00.000+0000",
    );
    expect(contactQuery!.query.get('q')).toContain('ORDER BY SystemModstamp ASC');
  });

  it('rejects non-alphanumeric values in SOQL literals (escape guard)', async () => {
    const { buildRecordSoql } = await import('../src/salesforce/api');
    expect(() =>
      buildRecordSoql('Account', { updatedAfter: "'; DROP TABLE Account; --" }),
    ).toThrow();
  });
});

describe('Salesforce sync — activities', () => {
  it('joins Tasks via WhatId and emits salesforce-activity chunks', async () => {
    const { fetchImpl } = makeFetch((req) => {
      const q = req.query.get('q') ?? '';
      if (q.includes('FROM Account')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '001',
              Name: 'Acme',
              CreatedDate: '2026-04-01T00:00:00.000+0000',
              SystemModstamp: '2026-05-03T10:00:00.000+0000',
            },
          ],
        });
      }
      if (q.includes('FROM Contact') || q.includes('FROM Opportunity')) {
        return jsonResponse({ totalSize: 0, done: true, records: [] });
      }
      if (q.includes('FROM Task')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: 't1',
              WhatId: '001',
              Subject: 'Follow-up call',
              Description: 'Discussed renewal terms.',
              CallType: 'Outbound',
              CallDurationInSeconds: 600,
              CreatedDate: '2026-05-02T15:00:00.000+0000',
              Owner: { Name: 'Alex Rep' },
            },
          ],
        });
      }
      if (
        q.includes('FROM Event') ||
        q.includes('FROM ContentDocumentLink') ||
        q.includes('FROM ContentNote')
      ) {
        return jsonResponse({ totalSize: 0, done: true, records: [] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's', fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });

    const activityChunks = enqueued.filter((c) => c.kind === 'salesforce-activity');
    expect(activityChunks.length).toBeGreaterThan(0);
    expect(activityChunks[0]!.sourceArtifactId).toBe('salesforce-account:001');
    expect(activityChunks[0]!.content).toContain('Discussed renewal terms');
  });

  it('continues indexing the record when its activity lookup throws', async () => {
    let activityAttempts = 0;
    const { fetchImpl } = makeFetch((req) => {
      const q = req.query.get('q') ?? '';
      if (q.includes('FROM Account')) {
        return jsonResponse({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '001',
              Name: 'Acme',
              CreatedDate: '2026-04-01T00:00:00.000+0000',
              SystemModstamp: '2026-05-03T10:00:00.000+0000',
            },
          ],
        });
      }
      if (q.includes('FROM Contact') || q.includes('FROM Opportunity')) {
        return jsonResponse({ totalSize: 0, done: true, records: [] });
      }
      if (q.includes('FROM Task') || q.includes('FROM Event')) {
        activityAttempts += 1;
        return jsonResponse({}, { status: 500 });
      }
      // Notes path also empty.
      if (q.includes('FROM ContentDocumentLink') || q.includes('FROM ContentNote')) {
        return jsonResponse({ totalSize: 0, done: true, records: [] });
      }
      return jsonResponse({}, { status: 404 });
    });

    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's', fetchImpl });
    const { stores, enqueued } = makeStores();
    await runConnectorSync({
      spec,
      stores,
      organizationId: 'o',
      sourceId: 's',
      fetchImpl,
    });
    expect(activityAttempts).toBeGreaterThan(0);
    // Account still indexed via its own properties.
    const accountChunks = enqueued.filter((c) => c.kind === 'salesforce-account');
    expect(accountChunks.length).toBeGreaterThan(0);
  });
});

describe('Salesforce sync — missing instanceUrl', () => {
  it('skips the resource gracefully when sources.metadata.instanceUrl is absent', async () => {
    const { fetchImpl } = makeFetch(() => jsonResponse({}, { status: 500 }));
    const spec = createSalesforceSpec({ clientId: 'c', clientSecret: 's', fetchImpl });
    const { stores } = makeStores({ sourceMetadata: {} });
    await expect(
      runConnectorSync({
        spec,
        stores,
        organizationId: 'o',
        sourceId: 's',
        fetchImpl,
      }),
    ).rejects.toThrow(/instanceUrl/i);
  });
});
