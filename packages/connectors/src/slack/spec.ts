import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  defineConnector,
  oauth2,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { evaluateAllowlist } from '../shared/allowlist';
import { createSlackApiClient } from './api';
import { processChannels, type ThreadsCursor } from './chunking';

/**
 * Read-only scopes — sufficient for ingest sync. Existing installs from before
 * the bot launch consented to exactly this set, so they keep working without
 * re-auth as long as we don't request the bot scopes for them.
 */
export const SLACK_INGEST_SCOPES = [
  'channels:history',
  'channels:read',
  'channels:join',
  'groups:history',
  'groups:read',
  'users:read',
  'team:read',
] as const;

/**
 * Additional scopes required for the @holo bot (mentions, DMs, slash
 * commands, outbound posting). Requesting these on top of
 * SLACK_INGEST_SCOPES triggers a Slack re-auth prompt for any workspace
 * whose install predates the bot.
 */
export const SLACK_BOT_SCOPES = [
  'app_mentions:read',
  'chat:write',
  'im:history',
  'im:read',
  'im:write',
  'commands',
] as const;

const BOT_SENTINEL_SCOPE = 'app_mentions:read';

/**
 * Returns true iff a stored credential row's `scope` column (Slack's
 * comma-separated string) includes the bot scope set. Used by the web app's
 * `bot-status` route to decide whether the workspace can host the @holo bot.
 */
export function hasSlackBotScopes(scope: string | null | undefined): boolean {
  if (!scope) return false;
  const set = new Set(scope.split(',').map((s) => s.trim()));
  return set.has(BOT_SENTINEL_SCOPE);
}

const SCOPES = [...SLACK_INGEST_SCOPES, ...SLACK_BOT_SCOPES];

export interface SlackSpecOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const threadsCursorSchema = z
  .object({
    /** Per-channel oldest-message-ts watermark. */
    oldestPerChannel: z.record(z.string(), z.string()).default({}),
    /** Channels we've discovered the bot isn't a member of (skipped). */
    botNotInChannel: z.array(z.string()).default([]),
  })
  .default({ oldestPerChannel: {}, botNotInChannel: [] });

/**
 * Resolve which channels to sync. Prefers an explicit allowlist; falls back
 * to "all channels the bot is a member of" when no allowlist row is set —
 * Slack's own membership UI is the access boundary, requiring admins to
 * re-pick channels here would be redundant friction.
 */
async function resolveChannels(
  ctx: ResourceSyncContext<ThreadsCursor>,
  client: ReturnType<typeof createSlackApiClient>,
): Promise<string[]> {
  try {
    const result = evaluateAllowlist(ctx.allowlist, {
      provider: 'slack',
      organizationId: ctx.organizationId,
    });
    return result.resolved;
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    const channels = await client.listMemberChannels();
    return channels.map((c) => c.id);
  }
}

export function createSlackSpec(opts: SlackSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'slack',
    displayName: 'Slack',

    auth: oauth2({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      authorizeUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: SCOPES,
      // Slack uses comma-separated scopes (not space-separated).
      scopeSeparator: ',',
      // Slack returns 200 with `{ ok: false, error }` on failure instead of
      // a non-2xx status — the okPredicate triggers our error path.
      okPredicate: (json) => (json as { ok?: boolean }).ok === true,
      // Slack bot tokens do not expire; no refresh exchange.
      refreshable: false,
      fetchImpl: opts.fetchImpl,
    }),

    http: {
      // Unused by the spec (Slack's `SlackApiClient` owns its own HTTP path
      // with custom rate-limit pacing), but populated so testConnection's
      // ctx.api is constructible. The framework currently requires it.
      baseUrl: 'https://slack.com/api',
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      const client = createSlackApiClient(ctx.tokens.accessToken, opts.fetchImpl);
      try {
        const team = await client.authTest();
        return {
          externalId: team.team_id,
          name: team.team,
          raw: { team_id: team.team_id, team: team.team },
        };
      } catch (err) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `Slack auth.test failed: ${(err as Error).message}`,
          fix: 'Re-install the Slack app to obtain a fresh bot token.',
        });
      }
    },

    resources: [
      {
        id: 'threads',
        displayName: 'Channel threads',
        cursorSchema: threadsCursorSchema,
        async sync(ctx: ResourceSyncContext<ThreadsCursor>): Promise<ThreadsCursor> {
          const client = createSlackApiClient(ctx.tokens.accessToken, opts.fetchImpl);

          const allowedChannelIds = await resolveChannels(ctx, client);
          if (allowedChannelIds.length === 0) {
            return ctx.cursor;
          }

          const next = await processChannels({ ctx, client, allowedChannelIds });
          return next;
        },
      },
    ],

    ui: {
      description: 'Channels, threads, DMs.',
      category: 'communication',
    },
  });
}
