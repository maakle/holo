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
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { schema, type DB } from '@holo/db';
import { ErrorCode } from '@holo/errors';
import {
  createGithubApiClient,
  resolveAllowlist,
  runGithubProseSync,
  runGithubCodeSync,
  loadGithubInstallationToken,
  listInstallationRepos,
  githubAppConfigFromEnv,
  type GithubProseEmbedEnqueueFn,
  type GithubCodeEmbedEnqueueFn,
  type GithubAppConfig,
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

const githubProseLogger = new Logger('GithubProseSync');
const githubCodeLogger = new Logger('GithubCodeSync');

const proseSyncLogger = {
  info: (obj: unknown) => githubProseLogger.log(JSON.stringify(obj)),
  warn: (obj: unknown) => githubProseLogger.warn(JSON.stringify(obj)),
};
const codeSyncLogger = {
  info: (obj: unknown) => githubCodeLogger.log(JSON.stringify(obj)),
  warn: (obj: unknown) => githubCodeLogger.warn(JSON.stringify(obj)),
};

/**
 * Lazy-loads the GitHub App config from env on first use. Throws a clear
 * error if env is missing — better than failing per-job.
 */
let cachedGithubAppConfig: GithubAppConfig | null = null;
function getGithubAppConfig(): GithubAppConfig {
  if (cachedGithubAppConfig) return cachedGithubAppConfig;
  cachedGithubAppConfig = githubAppConfigFromEnv({
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_APP_PRIVATE_KEY_B64: process.env.GITHUB_APP_PRIVATE_KEY_B64,
  });
  return cachedGithubAppConfig;
}

/**
 * Resolves which github repos this org's installation should sync. Prefers
 * the explicit allowlist (the picker) when set; falls back to "everything
 * the installation can access" when the allowlist is empty. The fallback
 * matters because admins already curate repos on GitHub's install page —
 * forcing a separate allowlist after install would be redundant friction.
 */
async function resolveGithubRepos(args: {
  db: DB;
  organizationId: string;
  installationToken: string;
}): Promise<string[]> {
  try {
    const allowlist = await resolveAllowlist({
      db: args.db,
      organizationId: args.organizationId,
      provider: 'github',
    });
    return allowlist.resolved;
  } catch (err) {
    if (
      err instanceof Object &&
      'code' in err &&
      (err as { code?: string }).code === ErrorCode.HOLO_ALLOWLIST_EMPTY
    ) {
      return listInstallationRepos({ token: args.installationToken });
    }
    throw err;
  }
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

// All API-key + OAuth connectors (slack, notion, grain, pylon, hubspot, linear)
// migrated to @holo/connector-framework — see runners.module.ts for
// registration via createGenericRunner(create<X>Spec(...), deps).

// Notion migrated to @holo/connector-framework — see runners.module.ts for
// the registration via createGenericRunner(createNotionSpec(), deps).

// ── GitHub prose ─────────────────────────────────────────────────────────────
// Calls runGithubProseSync directly. The split between prose and code matches
// the two BullMQ queues (different concurrency, different cost profiles).
export function createGithubProseRunner(deps: RunnerDeps): SyncRunner {
  const enqueueEmbed: GithubProseEmbedEnqueueFn = makeEnqueueEmbed(deps.embedQueue);

  const run = async (
    payload: SyncJobPayload,
    cursor: SyncCursor | null,
  ): Promise<SyncResult> => {
    const { token } = await loadGithubInstallationToken({
      db: deps.db,
      organizationId: payload.organizationId,
      config: getGithubAppConfig(),
    });
    const allowedRepos = await resolveGithubRepos({
      db: deps.db,
      organizationId: payload.organizationId,
      installationToken: token,
    });
    const existingHashes = await loadExistingHashes(deps.db, payload.organizationId);
    const result = await runGithubProseSync({
      client: createGithubApiClient(token),
      allowedRepos,
      cursorMetadata: cursor?.metadata ?? {},
      organizationId: payload.organizationId,
      sourceId: payload.sourceId,
      existingHashes,
      enqueueEmbed,
      logger: proseSyncLogger,
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
    const { token } = await loadGithubInstallationToken({
      db: deps.db,
      organizationId: payload.organizationId,
      config: getGithubAppConfig(),
    });
    const allowedRepos = await resolveGithubRepos({
      db: deps.db,
      organizationId: payload.organizationId,
      installationToken: token,
    });
    const existingHashes = await loadExistingHashes(deps.db, payload.organizationId);

    mkdirSync(workDirRoot, { recursive: true });

    let totalArtifacts = 0;
    const lastShas: Record<string, string> = {};

    for (const repoFullName of allowedRepos) {
      const workDir = workDirFor(workDirRoot, repoFullName);
      // x-access-token is the documented username for both OAuth and App
      // installation tokens; GitHub treats the username as informational.
      const cloneUrl = `https://x-access-token:${token}@github.com/${repoFullName}.git`;
      const result = await runGithubCodeSync({
        repoFullName,
        cloneUrl,
        workDir,
        fromSha,
        organizationId: payload.organizationId,
        sourceId: payload.sourceId,
        existingHashes,
        enqueueEmbed,
        logger: codeSyncLogger,
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

// Pylon, HubSpot, Notion, Grain migrated to @holo/connector-framework —
// see runners.module.ts for registration via createGenericRunner(createXSpec(...), deps).
