// Real SyncRunner implementations that wire the connector packages into the
// worker. The dispatcher (sync-dispatch.ts) calls runner.full / .incremental /
// .codeInitial / .codeIncremental based on the cursor; this module wires those
// methods to the underlying connector sync functions.
//
// Token loading: each runner reads the most recent active credential row
// for (organizationId, provider) from connector_credentials. encryptedText
// transparently decrypts the column.

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { schema, type DB } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import {
  createSlackConnector,
  createNotionConnector,
  createGithubApiClient,
  createGrainConnector,
  createPylonConnector,
  createHubspotConnector,
  resolveAllowlist,
  runGithubProseSync,
  runGithubCodeSync,
  type GithubProseEmbedEnqueueFn,
  type GithubCodeEmbedEnqueueFn,
  type HubspotEmbedEnqueueFn,
} from '@holo/connectors';
import type { SyncRunner, SyncResult } from './sync-dispatch';
import type { SyncJobPayload, SyncCursor } from './types';
import type { EmbedJobPayload, ChunkInsertPayload } from './embed-insert';

export type RunnerDeps = {
  db: DB;
  embedQueue: Queue<EmbedJobPayload>;
  /** Root directory for github clones; defaults to os.tmpdir()/holo-clones. */
  workDirRoot?: string;
};

async function loadConnectorToken(
  db: DB,
  organizationId: string,
  provider: 'github' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot',
): Promise<string> {
  const rows = await db
    .select({ accessToken: schema.connectorCredentials.accessToken })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, organizationId),
        eq(schema.connectorCredentials.provider, provider),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    )
    .orderBy(desc(schema.connectorCredentials.connectedAt))
    .limit(1);

  const token = rows[0]?.accessToken;
  if (!token) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: `No active ${provider} credential for organization ${organizationId}`,
      fix: `Connect ${provider} via the OAuth flow before scheduling syncs.`,
    });
  }
  return token;
}

async function loadExistingHashes(db: DB, organizationId: string): Promise<Set<string>> {
  const rows = await db
    .select({ contentHash: schema.chunks.contentHash })
    .from(schema.chunks)
    .where(eq(schema.chunks.organizationId, organizationId));
  return new Set(rows.map((r) => r.contentHash));
}

function makeEnqueueEmbed<T extends ChunkInsertPayload>(
  embedQueue: Queue<EmbedJobPayload>,
): (payload: { chunks: T[]; organizationId: string; sourceId: string }) => Promise<void> {
  return async (payload) => {
    if (payload.chunks.length === 0) return;
    await embedQueue.add('embed', {
      chunks: payload.chunks,
      organizationId: payload.organizationId,
      sourceArtifactId: payload.chunks[0]?.sourceArtifactId ?? '',
    });
  };
}

function workDirFor(root: string, repoFullName: string): string {
  const slug = createHash('sha1').update(repoFullName).digest('hex').slice(0, 12);
  const dir = join(root, slug);
  return dir;
}

// ── Slack ────────────────────────────────────────────────────────────────────
export function createSlackRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed = makeEnqueueEmbed(deps.embedQueue);
  const buildConnector = (): ReturnType<typeof createSlackConnector> =>
    createSlackConnector({
      // OAuth-only; the worker does not initiate OAuth, so empty strings are fine.
      clientId: process.env.SLACK_CONNECTOR_CLIENT_ID ?? '',
      clientSecret: process.env.SLACK_CONNECTOR_CLIENT_SECRET ?? '',
      db: deps.db,
      enqueueEmbed,
    });

  return {
    async full(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'slack');
      const result = await buildConnector().fullSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
    async incremental(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'slack');
      const result = await buildConnector().incrementalSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
  };
}

// ── Notion ───────────────────────────────────────────────────────────────────
export function createNotionRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed = makeEnqueueEmbed(deps.embedQueue);
  const buildConnector = (): ReturnType<typeof createNotionConnector> =>
    createNotionConnector({ db: deps.db, enqueueEmbed });

  return {
    async full(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'notion');
      const result = await buildConnector().fullSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
    async incremental(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'notion');
      const result = await buildConnector().incrementalSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
  };
}

// ── GitHub prose ─────────────────────────────────────────────────────────────
// Calls runGithubProseSync directly. The split between prose and code matches
// the two BullMQ queues (different concurrency, different cost profiles).
export function createGithubProseRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed: GithubProseEmbedEnqueueFn = makeEnqueueEmbed(deps.embedQueue);

  const run = async (
    payload: SyncJobPayload,
    cursor: SyncCursor | null,
  ): Promise<SyncResult> => {
    const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'github');
    const allowlist = await resolveAllowlist({
      db: deps.db,
      organizationId: payload.organizationId,
      provider: 'github',
    });
    const existingHashes = await loadExistingHashes(deps.db, payload.organizationId);
    const result = await runGithubProseSync({
      client: createGithubApiClient(accessToken),
      allowedRepos: allowlist.resolved,
      cursorMetadata: cursor?.metadata ?? {},
      organizationId: payload.organizationId,
      sourceId: payload.sourceId,
      existingHashes,
      enqueueEmbed,
    });
    return {
      artifactCount: result.artifactCount,
      newCursor: new Date(),
      metadataPatch: result.updatedMetadata,
    };
  };

  return {
    full: (payload) => run(payload, null),
    incremental: (payload, cursor) => run(payload, cursor),
  };
}

// ── GitHub code ──────────────────────────────────────────────────────────────
export function createGithubCodeRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed: GithubCodeEmbedEnqueueFn = makeEnqueueEmbed(deps.embedQueue);
  const workDirRoot = deps.workDirRoot ?? join(tmpdir(), 'holo-clones');

  const run = async (
    payload: SyncJobPayload,
    fromSha: string | undefined,
  ): Promise<SyncResult> => {
    const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'github');
    const allowlist = await resolveAllowlist({
      db: deps.db,
      organizationId: payload.organizationId,
      provider: 'github',
    });
    const existingHashes = await loadExistingHashes(deps.db, payload.organizationId);

    mkdirSync(workDirRoot, { recursive: true });

    let totalArtifacts = 0;
    const lastShas: Record<string, string> = {};

    for (const repoFullName of allowlist.resolved) {
      const workDir = workDirFor(workDirRoot, repoFullName);
      const cloneUrl = `https://x-access-token:${accessToken}@github.com/${repoFullName}.git`;
      const result = await runGithubCodeSync({
        repoFullName,
        cloneUrl,
        workDir,
        fromSha,
        organizationId: payload.organizationId,
        sourceId: payload.sourceId,
        existingHashes,
        enqueueEmbed,
        // treeSitter is omitted here — when null, githubCodeChunker falls back to
        // recursiveSplit. A real TreeSitterRegistry can be injected later via
        // RunnerDeps if AST chunking is desired in production.
      });
      totalArtifacts += result.artifactCount;
      lastShas[repoFullName] = result.headSha;
    }

    return {
      artifactCount: totalArtifacts,
      newCursor: new Date(),
      metadataPatch: { last_indexed_sha: pickRepresentativeSha(lastShas) },
    };
  };

  return {
    codeInitial: (payload) => run(payload, undefined),
    codeIncremental: (payload, cursor) => {
      const sha = cursor.metadata['last_indexed_sha'];
      return run(payload, typeof sha === 'string' ? sha : undefined);
    },
  };
}

function pickRepresentativeSha(shas: Record<string, string>): string {
  const values = Object.values(shas);
  return values[0] ?? '';
}

// ── Grain ────────────────────────────────────────────────────────────────────
export function createGrainRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed = makeEnqueueEmbed(deps.embedQueue);
  const buildConnector = (): ReturnType<typeof createGrainConnector> =>
    createGrainConnector({
      clientId: process.env.GRAIN_CONNECTOR_CLIENT_ID ?? '',
      clientSecret: process.env.GRAIN_CONNECTOR_CLIENT_SECRET ?? '',
      db: deps.db,
      enqueueEmbed,
    });

  return {
    async full(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'grain');
      const result = await buildConnector().fullSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
    async incremental(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'grain');
      const result = await buildConnector().incrementalSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
  };
}

// ── Pylon ────────────────────────────────────────────────────────────────────
export function createPylonRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed = makeEnqueueEmbed(deps.embedQueue);

  return {
    async full(payload: SyncJobPayload): Promise<SyncResult> {
      const apiKey = await loadConnectorToken(deps.db, payload.organizationId, 'pylon');
      const connector = createPylonConnector({ apiKey, db: deps.db, enqueueEmbed });
      const result = await connector.fullSync(
        { accessToken: apiKey },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
    async incremental(payload: SyncJobPayload): Promise<SyncResult> {
      const apiKey = await loadConnectorToken(deps.db, payload.organizationId, 'pylon');
      const connector = createPylonConnector({ apiKey, db: deps.db, enqueueEmbed });
      const result = await connector.incrementalSync(
        { accessToken: apiKey },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
  };
}

// ── HubSpot ──────────────────────────────────────────────────────────────────
export function createHubspotRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed: HubspotEmbedEnqueueFn = makeEnqueueEmbed(deps.embedQueue);
  const buildConnector = (): ReturnType<typeof createHubspotConnector> =>
    createHubspotConnector({
      // OAuth client credentials are only needed for buildAuthorizeUrl/exchange/refresh,
      // which the worker never invokes. Worker-side we only need db + enqueueEmbed.
      clientId: process.env.HUBSPOT_CONNECTOR_CLIENT_ID ?? '',
      clientSecret: process.env.HUBSPOT_CONNECTOR_CLIENT_SECRET ?? '',
      db: deps.db,
      enqueueEmbed,
    });

  return {
    async full(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'hubspot');
      const result = await buildConnector().fullSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
    async incremental(payload: SyncJobPayload): Promise<SyncResult> {
      const accessToken = await loadConnectorToken(deps.db, payload.organizationId, 'hubspot');
      const result = await buildConnector().incrementalSync(
        { accessToken },
        { sourceId: payload.sourceId, organizationId: payload.organizationId, cursorScope: 'sync' },
      );
      return { artifactCount: result.artifactCount, newCursor: result.newCursor };
    },
  };
}
