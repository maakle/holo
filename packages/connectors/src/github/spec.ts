import { z } from 'zod';
import { ErrorCode } from '@holo/errors';
import {
  defineConnector,
  githubApp,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { listInstallationRepos } from './auth';
import { defaultWorkDirRoot, processCodeRepos, processProseRepos } from './chunking';

export interface GithubSpecOptions {
  /** GitHub App credentials. */
  appId: string;
  /** PEM-encoded RSA private key (already base64-decoded). */
  privateKeyPem: string;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Root directory for git clones. Defaults to os.tmpdir()/holo-clones. */
  workDirRoot?: string;
}

/**
 * GitHub uses two BullMQ queues with different concurrency profiles
 * (prose runs in parallel; code clones serialise per repo). The framework
 * handles this via the runner's `resources` filter — one runner per queue,
 * each scoped to a single resource on the same spec.
 */
const proseCursorSchema = z
  .record(z.string(), z.unknown())
  .default({});

const codeCursorSchema = z
  .record(z.string(), z.unknown())
  .default({});

/**
 * Resolve which repos to sync. Prefers an explicit allowlist; falls back
 * to "every repo the installation can access" when no allowlist row is set
 * — admins already curate repos on GitHub's install page, so requiring
 * them to re-pick repos here would be redundant friction.
 */
async function resolveRepos(args: {
  ctx: ResourceSyncContext<Record<string, unknown>>;
  token: string;
}): Promise<string[]> {
  try {
    const result = evaluateAllowlist(args.ctx.allowlist, {
      provider: 'github',
      organizationId: args.ctx.organizationId,
    });
    return result.resolved;
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    return listInstallationRepos({ token: args.token });
  }
}

export function createGithubSpec(opts: GithubSpecOptions): ConnectorSpec {
  const auth = githubApp({
    appId: opts.appId,
    privateKeyPem: opts.privateKeyPem,
    fetchImpl: opts.fetchImpl,
  });
  const workDirRoot = opts.workDirRoot ?? defaultWorkDirRoot();

  return defineConnector({
    id: 'github',
    displayName: 'GitHub',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.github },

    auth,

    http: {
      // The legacy GithubApiClient owns its own HTTP path; populated here so
      // testConnection's ctx.api is constructible. The framework currently
      // requires it.
      baseUrl: 'https://api.github.com',
      defaultHeaders: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The token here is already an installation access token (the runtime
      // mints it via mintInstallationToken before invoking sync). We probe
      // /installation/repositories to validate it; that endpoint surfaces the
      // installation account, which is the closest thing GitHub Apps give us
      // to a "workspace" identity.
      const reposJson = await ctx.api.get<{
        repositories: Array<{ owner: { login: string } }>;
      }>('/installation/repositories', { query: { per_page: 1 } });
      const login = reposJson.repositories?.[0]?.owner?.login ?? 'github';
      return {
        externalId: login,
        name: login,
      };
    },

    resources: [
      {
        id: 'prose',
        displayName: 'Prose (markdown, PRs, issues)',
        cursorSchema: proseCursorSchema,
        async sync(
          ctx: ResourceSyncContext<Record<string, unknown>>,
        ): Promise<Record<string, unknown>> {
          const allowedRepos = await resolveRepos({ ctx, token: ctx.tokens.accessToken });
          if (allowedRepos.length === 0) return ctx.cursor;

          const result = await processProseRepos({
            ctx,
            token: ctx.tokens.accessToken,
            allowedRepos,
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
          const allowedRepos = await resolveRepos({ ctx, token: ctx.tokens.accessToken });
          if (allowedRepos.length === 0) return ctx.cursor;

          const result = await processCodeRepos({
            ctx,
            token: ctx.tokens.accessToken,
            allowedRepos,
            workDirRoot,
          });
          // Single watermark for now (matches legacy `last_indexed_sha`
          // behavior). Per-repo state can move to its own field later
          // without changing the cursor scope.
          const firstRepoSha = Object.values(result.perRepoSha)[0] ?? '';
          return {
            ...ctx.cursor,
            last_indexed_sha: firstRepoSha,
            per_repo_sha: result.perRepoSha,
          };
        },
      },
    ],

    ui: {
      description: 'Code, pull requests, issues, and markdown docs.',
      category: 'vcs',
    },
  });
}
