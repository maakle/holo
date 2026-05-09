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
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { listAllSpaces } from './api';
import { processSpaces, type ThreadsCursor } from './chunking';
import type { GoogleChatSpace } from './types';

/**
 * Read-only scopes — sufficient for ingest. We deliberately avoid Workspace
 * Admin scopes (`chat.admin.*`) so installing the connector doesn't require
 * super-admin consent in Google Workspace.
 *
 * `chat.spaces.readonly` lets us enumerate spaces the consenting user is in;
 * `chat.messages.readonly` lets us read those spaces' history. Coverage is
 * therefore "spaces the connecting user has joined" — same membership shape
 * as Slack's bot-as-member model.
 */
export const GOOGLE_CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.messages.readonly',
  // Standard OIDC scopes so testConnection has something stable to identify
  // the workspace by (Chat doesn't expose a workspace identity endpoint).
  'openid',
  'email',
] as const;

export interface GoogleChatSpecOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

const threadsCursorSchema = z
  .object({
    /** Per-space `createTime` watermark (RFC 3339). */
    createdAfterPerSpace: z.record(z.string(), z.string()).default({}),
  })
  .default({ createdAfterPerSpace: {} });

/**
 * Resolve which spaces to sync. Prefers an explicit allowlist; falls back to
 * "all spaces the user is a member of" when no allowlist row is set — Google
 * Chat's own membership UI is the access boundary, requiring admins to
 * re-pick spaces here would be redundant friction. Mirrors Slack's behaviour.
 */
async function resolveSpaces(
  ctx: ResourceSyncContext<ThreadsCursor>,
  allSpaces: ReadonlyArray<GoogleChatSpace>,
): Promise<GoogleChatSpace[]> {
  try {
    const result = evaluateAllowlist(ctx.allowlist, {
      provider: 'google-chat',
      organizationId: ctx.organizationId,
    });
    const allowed = new Set(result.resolved);
    return allSpaces.filter((s) => allowed.has(s.name));
  } catch (err) {
    if ((err as { code?: string }).code !== ErrorCode.HOLO_ALLOWLIST_EMPTY) throw err;
    // Default: every space the user is in. Skip DMs to avoid ingesting
    // private 1:1 chats by accident — admins can opt them in via allowlist.
    return allSpaces.filter((s) => s.spaceType !== 'DIRECT_MESSAGE');
  }
}

export function createGoogleChatSpec(opts: GoogleChatSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'google-chat',
    displayName: 'Google Chat',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER['google-chat'] },

    auth: oauth2({
      clientId: opts.clientId,
      clientSecret: opts.clientSecret,
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_CHAT_SCOPES,
      // Google issues refresh tokens only when `access_type=offline` and
      // `prompt=consent` are set on the authorize URL — handled by the
      // initiate route via extra params (see web/api/connectors/[provider]).
      refreshable: true,
      fetchImpl: opts.fetchImpl,
    }),

    http: {
      baseUrl: 'https://chat.googleapis.com',
      defaultHeaders: { Accept: 'application/json' },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // Google's userinfo endpoint identifies the consenting user; Chat itself
      // has no /me. We use the email's domain as the workspace name proxy so
      // the dashboard shows something meaningful.
      try {
        const info = await ctx.api.get<{
          sub: string;
          email?: string;
          name?: string;
        }>('https://openidconnect.googleapis.com/v1/userinfo');
        const domain = info.email?.split('@')[1] ?? '';
        return {
          externalId: domain || info.sub,
          name: domain ? `Google Chat · ${domain}` : (info.name ?? info.email ?? 'Google Chat'),
          raw: { sub: info.sub, email: info.email },
        };
      } catch (err) {
        throw holoError({
          code: ErrorCode.HOLO_OAUTH_EXCHANGE_FAILED,
          problem: `Google userinfo failed: ${(err as Error).message}`,
          fix: 'Re-authorize the Google Chat connector to obtain a fresh token.',
        });
      }
    },

    resources: [
      {
        id: 'threads',
        displayName: 'Space threads',
        cursorSchema: threadsCursorSchema,
        async sync(ctx: ResourceSyncContext<ThreadsCursor>): Promise<ThreadsCursor> {
          const spaces = await listAllSpaces(ctx.api);
          const allowed = await resolveSpaces(ctx, spaces);
          if (allowed.length === 0) return ctx.cursor;
          return processSpaces({ ctx, spaces: allowed });
        },
      },
    ],

    ui: {
      description: 'Spaces, threads, and messages from Google Chat.',
      category: 'communication',
    },
  });
}
