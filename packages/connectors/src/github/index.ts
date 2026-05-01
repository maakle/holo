import type {
  Connector,
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  ConnectorTokens,
  TestConnectionResult,
  RefreshInput,
  SyncResult,
  SyncContext,
  WebhookEnvelope,
  NormalizedWebhookEvent,
} from '../contract';
import { holoError, ErrorCode } from '@holo/errors';
import { resolveAllowlist } from '../shared/allowlist';
import { createGithubApiClient } from './api-client';
import { runGithubProseSync, type GithubProseEmbedEnqueueFn } from './sync-prose';
import { runGithubCodeSync, type GithubCodeEmbedEnqueueFn } from './sync-code';
import type { DB } from '@holo/db';

export interface GithubConnectorOptions {
  clientId: string;
  clientSecret: string;
  db?: DB;
  enqueueProseEmbed?: GithubProseEmbedEnqueueFn;
  enqueueCodeEmbed?: GithubCodeEmbedEnqueueFn;
  getCloneUrl?: (repoFullName: string, token: string) => string;
  getWorkDir?: (repoFullName: string) => string;
  fetchImpl?: typeof fetch;
}

function defaultCloneUrl(repoFullName: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${repoFullName}.git`;
}

export function createGithubConnector(opts: GithubConnectorOptions): Connector {
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    id: 'github',
    displayName: 'GitHub',

    buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', opts.clientId);
      url.searchParams.set('redirect_uri', input.redirectUri);
      url.searchParams.set('scope', 'repo read:org');
      url.searchParams.set('state', input.state);
      return url.toString();
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens> {
      const res = await fetchImpl('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: opts.clientId,
          client_secret: opts.clientSecret,
          code: input.code,
          redirect_uri: input.redirectUri,
        }),
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `GitHub OAuth code exchange returned HTTP ${res.status}`,
          fix: 'Verify GITHUB_CONNECTOR_CLIENT_ID/SECRET and the OAuth app callback URL.',
        });
      }
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data['error'] === 'string') {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `GitHub OAuth code exchange returned error: ${data['error']}`,
          cause:
            typeof data['error_description'] === 'string'
              ? data['error_description']
              : undefined,
          fix: 'Restart the connect flow. If it persists, verify the OAuth app config.',
        });
      }
      const accessToken = data['access_token'];
      if (typeof accessToken !== 'string') {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: 'GitHub OAuth response did not include access_token',
          fix: 'Restart the connect flow.',
        });
      }
      return {
        accessToken,
        refreshToken:
          typeof data['refresh_token'] === 'string' ? data['refresh_token'] : undefined,
        scope: typeof data['scope'] === 'string' ? data['scope'] : undefined,
      };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub token refresh is not implemented',
        fix: 'Re-authorize the GitHub connector.',
      });
    },

    async testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult> {
      const res = await fetchImpl('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) {
        throw holoError({
          code: ErrorCode.HOLO_GITHUB_TOKEN_INVALID,
          problem: `GitHub /user check returned HTTP ${res.status}`,
          fix: 'Token may be invalid. Restart the connect flow.',
        });
      }
      const data = (await res.json()) as { id: number; login: string };
      return {
        ok: true,
        externalId: String(data.id),
        name: data.login,
        raw: data as unknown as Record<string, unknown>,
      };
    },

    async fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueProseEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'GitHub fullSync requires db and enqueueProseEmbed injected at construction',
          fix: 'Pass db and enqueueProseEmbed options when calling createGithubConnector().',
        });
      }
      const allowlist = await resolveAllowlist({
        db: opts.db,
        organizationId: ctx.organizationId,
        provider: 'github',
      });
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const client = createGithubApiClient(tokens.accessToken, fetchImpl);

      const proseResult = await runGithubProseSync({
        client,
        allowedRepos: allowlist.resolved,
        cursorMetadata: {},
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueProseEmbed,
      });

      let codeCount = 0;
      if (opts.enqueueCodeEmbed && opts.getWorkDir) {
        for (const repo of allowlist.resolved) {
          const workDir = opts.getWorkDir(repo);
          const cloneUrl = (opts.getCloneUrl ?? defaultCloneUrl)(repo, tokens.accessToken);
          const codeResult = await runGithubCodeSync({
            repoFullName: repo,
            cloneUrl,
            workDir,
            organizationId: ctx.organizationId,
            sourceId: ctx.sourceId,
            existingHashes,
            enqueueEmbed: opts.enqueueCodeEmbed,
          });
          codeCount += codeResult.artifactCount;
        }
      }

      return {
        artifactCount: proseResult.artifactCount + codeCount,
        newCursor: new Date(),
      };
    },

    async incrementalSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult> {
      if (!opts.db || !opts.enqueueProseEmbed) {
        throw holoError({
          code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
          problem: 'GitHub incrementalSync requires db and enqueueProseEmbed injected at construction',
          fix: 'Pass db and enqueueProseEmbed options when calling createGithubConnector().',
        });
      }
      const allowlist = await resolveAllowlist({
        db: opts.db,
        organizationId: ctx.organizationId,
        provider: 'github',
      });
      const cursor = await loadCursorMetadata(opts.db, ctx.sourceId);
      const existingHashes = await loadExistingHashes(opts.db, ctx.organizationId);
      const client = createGithubApiClient(tokens.accessToken, fetchImpl);

      const proseResult = await runGithubProseSync({
        client,
        allowedRepos: allowlist.resolved,
        cursorMetadata: cursor,
        organizationId: ctx.organizationId,
        sourceId: ctx.sourceId,
        existingHashes,
        enqueueEmbed: opts.enqueueProseEmbed,
      });

      let codeCount = 0;
      if (opts.enqueueCodeEmbed && opts.getWorkDir) {
        const lastShas = (cursor['last_code_sha'] as Record<string, string>) ?? {};
        for (const repo of allowlist.resolved) {
          const workDir = opts.getWorkDir(repo);
          const cloneUrl = (opts.getCloneUrl ?? defaultCloneUrl)(repo, tokens.accessToken);
          const codeResult = await runGithubCodeSync({
            repoFullName: repo,
            cloneUrl,
            workDir,
            fromSha: lastShas[repo],
            organizationId: ctx.organizationId,
            sourceId: ctx.sourceId,
            existingHashes,
            enqueueEmbed: opts.enqueueCodeEmbed,
          });
          codeCount += codeResult.artifactCount;
        }
      }

      return {
        artifactCount: proseResult.artifactCount + codeCount,
        newCursor: new Date(),
      };
    },

    verifyWebhook(_env: WebhookEnvelope, _secret: string): boolean {
      return false;
    },

    normalizeWebhook(_env: WebhookEnvelope): NormalizedWebhookEvent {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'GitHub webhook normalization is deferred to v0.2',
        fix: 'Implement webhook handling in a later release.',
      });
    },
  };
}

async function loadCursorMetadata(db: DB, sourceId: string): Promise<Record<string, unknown>> {
  const { schema } = await import('@holo/db');
  const { eq, and } = await import('drizzle-orm');
  const rows = await db
    .select({ metadata: schema.connectorCursors.metadata })
    .from(schema.connectorCursors)
    .where(
      and(
        eq(schema.connectorCursors.sourceId, sourceId),
        eq(schema.connectorCursors.scope, 'sync'),
      ),
    )
    .limit(1);
  return rows[0]?.metadata ?? {};
}

async function loadExistingHashes(db: DB, organizationId: string): Promise<Set<string>> {
  const { schema } = await import('@holo/db');
  const { eq } = await import('drizzle-orm');
  const rows = await db
    .select({ contentHash: schema.chunks.contentHash })
    .from(schema.chunks)
    .where(eq(schema.chunks.organizationId, organizationId));
  return new Set(rows.map((r) => r.contentHash));
}
