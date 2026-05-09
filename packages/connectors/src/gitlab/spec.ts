import { z } from 'zod';
import { ErrorCode } from '@holo/errors';
import {
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { listAccessibleProjects } from './auth';
import { processCodeProjects, processProseProjects } from './chunking';

export interface GitlabSpecOptions {
  /** OAuth2 application credentials registered at gitlab.com/-/profile/applications. */
  clientId: string;
  clientSecret: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * GitLab uses two BullMQ queues with different concurrency profiles
 * (prose runs in parallel; code serialises per project). The framework
 * runs one queue per resource on the same spec instance.
 */
const proseCursorSchema = z.record(z.string(), z.unknown()).default({});
const codeCursorSchema = z.record(z.string(), z.unknown()).default({});

interface ResolvedProject {
  id: number;
  pathWithNamespace: string;
  defaultBranch: string | null;
}

/**
 * Resolve which projects to sync. If the operator has rows in the
 * `connector_allowlists` table for `provider='gitlab'`, those are
 * authoritative — the rows store either project ids or path globs and
 * the matching subset of the user's accessible projects is returned.
 * Otherwise we fall back to "every project the OAuth grant can reach",
 * mirroring the GitHub spec's behaviour.
 *
 * Allowlist patterns are matched against `path_with_namespace`; bare
 * numeric ids match the project id directly.
 */
async function resolveProjects(args: {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<ResolvedProject[]> {
  const all = await listAccessibleProjects({ token: args.token, fetchImpl: args.fetchImpl });

  let allowedKeys: string[] | null = null;
  try {
    const result = evaluateAllowlist(args.ctx.allowlist, {
      provider: 'gitlab',
      organizationId: args.ctx.organizationId,
    });
    allowedKeys = result.resolved;
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    return all;
  }

  if (!allowedKeys || allowedKeys.length === 0) return all;
  const allowedSet = new Set(allowedKeys);
  return all.filter(
    (p) => allowedSet.has(p.pathWithNamespace) || allowedSet.has(String(p.id)),
  );
}

export function createGitlabSpec(opts: GitlabSpecOptions): ConnectorSpec {
  const auth = oauth2({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
    authorizeUrl: 'https://gitlab.com/oauth/authorize',
    tokenUrl: 'https://gitlab.com/oauth/token',
    // read_api covers projects/MRs/issues; read_repository is needed for
    // /repository/files/raw and tree listing; read_user is needed by /user.
    scopes: ['read_api', 'read_repository', 'read_user'],
    refreshable: true,
    fetchImpl: opts.fetchImpl,
  });

  return defineConnector({
    id: 'gitlab',
    displayName: 'GitLab',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.gitlab },

    auth,

    http: {
      // Constructed for testConnection; the prose/code sync engines use
      // their own client wired with the installation token to keep the
      // GitHub-style adapter shape.
      baseUrl: 'https://gitlab.com/api/v4',
      defaultHeaders: { Accept: 'application/json' },
      // GitLab.com's default API rate limit is generous (~600/min); we
      // pace conservatively and let Retry-After cover the rest.
      rateLimit: { rps: 5, burst: 20 },
      retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const user = await ctx.api.get<{ id: number; username: string; name: string }>(
        '/user',
      );
      return {
        externalId: String(user.id),
        name: user.username,
        raw: { user },
      };
    },

    resources: [
      {
        id: 'prose',
        displayName: 'Prose (markdown, MRs, issues)',
        cursorSchema: proseCursorSchema,
        async sync(
          ctx: ResourceSyncContext<Record<string, unknown>>,
        ): Promise<Record<string, unknown>> {
          const allowedProjects = await resolveProjects({
            ctx,
            token: ctx.tokens.accessToken,
            fetchImpl: opts.fetchImpl,
          });
          if (allowedProjects.length === 0) return ctx.cursor;

          const result = await processProseProjects({
            ctx,
            token: ctx.tokens.accessToken,
            allowedProjects,
          });
          return result.updatedMetadata;
        },
      },
      {
        id: 'code',
        displayName: 'Source code (chunked)',
        cursorSchema: codeCursorSchema,
        async sync(
          ctx: ResourceSyncContext<Record<string, unknown>>,
        ): Promise<Record<string, unknown>> {
          const allowedProjects = await resolveProjects({
            ctx,
            token: ctx.tokens.accessToken,
            fetchImpl: opts.fetchImpl,
          });
          if (allowedProjects.length === 0) return ctx.cursor;

          const result = await processCodeProjects({
            ctx,
            token: ctx.tokens.accessToken,
            allowedProjects,
          });
          // Mirror GitHub's `last_indexed_sha` field so the dispatcher's
          // `decideSyncMode` branch (initial vs incremental) lights up
          // identically for the gitlab-code-sync queue.
          const firstSha = Object.values(result.perProjectSha)[0] ?? '';
          return {
            ...ctx.cursor,
            last_indexed_sha: firstSha,
            per_project_sha: result.perProjectSha,
          };
        },
      },
    ],

    ui: {
      description: 'Code, merge requests, issues, and markdown docs.',
      category: 'vcs',
    },
  });
}
