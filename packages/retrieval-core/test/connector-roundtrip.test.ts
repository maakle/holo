import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, type DB } from '@holo/db';
import { createOpenAiEmbedder } from '@holo/embedder';
import {
  runGithubProseSync,
  type GithubApiClient,
  type GithubProseChunkPayload,
} from '@holo/connectors';
import { search } from '../src/search.js';

/**
 * Connector-roundtrip integration test (Phase 12.2).
 *
 * Exercises the full pipeline that a worker run would execute, but in a
 * single test process and with the GitHub API mocked at the GithubApiClient
 * boundary (no nock needed):
 *
 *   1. Seed allowlist row + connector_credentials for a test org
 *   2. Run runGithubProseSync with a mock GithubApiClient that returns one
 *      hand-crafted PR
 *   3. Capture the chunks the sync emitted via enqueueEmbed
 *   4. Embed them with real OpenAI + insert into the chunks table (this is
 *      what the embed worker would do)
 *   5. Call search() and assert the PR's body chunk surfaces in top-3
 *
 * The Playwright multi-process variant from the v0.0 plan is deferred —
 * this vitest covers the same flow with less infrastructure.
 *
 * Requires DATABASE_URL + OPENAI_API_KEY. Skipped without OPENAI_API_KEY.
 */

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
const openaiKey = process.env.OPENAI_API_KEY;
const TEST_SLUG = 'test-roundtrip';
const REPO = 'acme/widgets';
const PR_NUMBER = 99;

let db: DB;
let orgId: string;
let userId: string;
let sourceId: string;

function buildMockClient(): GithubApiClient {
  return {
    getRepo: vi.fn().mockResolvedValue({
      full_name: REPO,
      default_branch: 'main',
      pushed_at: '2026-04-01T00:00:00Z',
    }),
    listPullRequests: vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            number: PR_NUMBER,
            title: 'Add UKG Pro retention dashboard',
            body: 'Tracks 30-day MFA retention for users who completed enrollment. Closes #50.',
            state: 'closed',
            updated_at: '2026-04-15T12:00:00Z',
            merged_at: '2026-04-15T12:00:00Z',
          },
        ],
        hasMore: false,
      })
      .mockResolvedValue({ items: [], hasMore: false }),
    getPrFiles: vi.fn().mockResolvedValue([
      { filename: 'src/dashboard/retention.ts', patch: '+ export const MFA_RETENTION = true;', status: 'added' },
    ]),
    getPrReviews: vi.fn().mockResolvedValue([]),
    getPrReviewComments: vi.fn().mockResolvedValue([]),
    getIssue: vi.fn().mockResolvedValue(null),
    listIssues: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getIssueComments: vi.fn().mockResolvedValue([]),
    getRef: vi.fn().mockResolvedValue({ sha: 'tree-abc' }),
    getTree: vi.fn().mockResolvedValue([]),
    getFileContent: vi.fn().mockResolvedValue(null),
  };
}

beforeAll(async () => {
  if (!openaiKey) return;
  db = createDb(url);

  const orgRes = await db.execute<{ id: string }>(sql`
    INSERT INTO organization (slug, name) VALUES (${TEST_SLUG}, 'roundtrip test org')
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  orgId = ((orgRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (orgRes as unknown as Array<{ id: string }>))[0]!.id;

  const userRes = await db.execute<{ id: string }>(sql`
    INSERT INTO "user" (email, organization_id, email_verified)
    VALUES (${`roundtrip-${Date.now()}@holo.test`}, ${orgId}, true)
    RETURNING id
  `);
  userId = ((userRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (userRes as unknown as Array<{ id: string }>))[0]!.id;

  // Stale-data sweep
  await db.execute(sql`DELETE FROM connector_allowlists WHERE organization_id = ${orgId}`);
  await db.execute(sql`DELETE FROM sources WHERE organization_id = ${orgId}`);

  // Seed allowlist row
  await db.execute(sql`
    INSERT INTO connector_allowlists
      (organization_id, provider, pattern, pattern_kind, decision, created_by)
    VALUES (${orgId}, 'github', ${REPO}, 'exact_id', 'include', ${userId})
  `);

  // Seed source + artifact for FK constraints
  const srcRes = await db.execute<{ id: string }>(sql`
    INSERT INTO sources (organization_id, provider, external_id, name)
    VALUES (${orgId}, 'github', ${`src-${REPO}`}, ${REPO})
    RETURNING id
  `);
  sourceId = ((srcRes as unknown as { rows?: Array<{ id: string }> }).rows
    ?? (srcRes as unknown as Array<{ id: string }>))[0]!.id;

  await db.execute(sql`
    INSERT INTO source_artifacts
      (organization_id, source_id, kind, external_id, fetched_at, payload)
    VALUES (${orgId}, ${sourceId}, 'github-pr', ${`pr:${REPO}#${PR_NUMBER}`}, now(), '{}'::jsonb)
  `);
}, 30_000);

afterAll(async () => {
  if (!openaiKey || !orgId) return;
  await db.execute(sql`DELETE FROM sources WHERE organization_id = ${orgId}`);
  await db.execute(sql`DELETE FROM connector_allowlists WHERE organization_id = ${orgId}`);
  await db.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
});

describe('connector roundtrip (Phase 12.2)', () => {
  it.runIf(!!openaiKey)(
    'github sync → embed → DB → search returns the seeded PR in top-3',
    async () => {
      // 1. Run sync with mock GithubApiClient — capture chunks via enqueueEmbed
      const captured: GithubProseChunkPayload[] = [];
      await runGithubProseSync({
        client: buildMockClient(),
        allowedRepos: [REPO],
        cursorMetadata: {},
        organizationId: orgId,
        sourceId,
        existingHashes: new Set(),
        enqueueEmbed: async (payload) => {
          captured.push(...payload.chunks);
        },
      });
      expect(captured.length).toBeGreaterThan(0);
      expect(captured.some((c) => c.kind === 'github-pr')).toBe(true);

      // 2. Look up the source_artifact row that the chunks reference
      const artRes = await db.execute<{ id: string }>(sql`
        SELECT id FROM source_artifacts
         WHERE organization_id = ${orgId}
           AND external_id = ${`pr:${REPO}#${PR_NUMBER}`}
         LIMIT 1
      `);
      const artifactId = ((artRes as unknown as { rows?: Array<{ id: string }> }).rows
        ?? (artRes as unknown as Array<{ id: string }>))[0]!.id;

      // 3. Embed via real OpenAI + bulk insert (mirrors what the embed worker does)
      const embedder = createOpenAiEmbedder({ apiKey: openaiKey! });
      const vectors = await embedder.embed(captured.map((c) => c.content));
      for (let i = 0; i < captured.length; i++) {
        const c = captured[i]!;
        const vec = vectors[i]!;
        const literal = `[${vec.join(',')}]`;
        await db.execute(sql`
          INSERT INTO chunks
            (organization_id, source_id, source_artifact_id, kind, content, content_hash,
             provider, embedding_model, embedding, metadata, acl_subjects)
          VALUES (
            ${orgId}, ${sourceId}, ${artifactId},
            ${c.kind}, ${c.content}, ${c.contentHash},
            'github', 'openai-3-large',
            ${literal}::vector(1024),
            ${JSON.stringify(c.metadata)}::jsonb,
            ARRAY[${'org:' + orgId}]::text[]
          )
          ON CONFLICT (organization_id, content_hash) DO NOTHING
        `);
      }

      // 4. Run a search and assert the PR surfaces
      const results = await search({
        db,
        organizationId: orgId,
        q: 'MFA retention dashboard',
        topK: 5,
        userSubjects: [`org:${orgId}`],
      });

      const top3 = results.slice(0, 3).map((r) => r.content);
      const found = top3.some(
        (content) => content.includes('MFA') || content.includes('UKG Pro retention'),
      );
      expect(found).toBe(true);
    },
    60_000,
  );

  it.runIf(!openaiKey)('skipped (no OPENAI_API_KEY in env)', () => {
    expect(true).toBe(true);
  });
});
