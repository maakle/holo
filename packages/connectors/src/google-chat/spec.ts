import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  defineConnector,
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
 * Read-only scopes the SA needs after domain-wide delegation. Defined in
 * @holo/sync-providers so the wizard UI (client-side) and the worker
 * (server-side, mints tokens) read from the same source. The Workspace
 * admin lists exactly these in Admin Console → Security → API Controls →
 * Domain-wide Delegation.
 *
 * `chat.spaces.readonly` enumerates spaces the impersonated user is in;
 * `chat.messages.readonly` reads their history. `openid` + `email` give
 * testConnection a stable identity probe (Chat has no workspace endpoint).
 */
export { GOOGLE_CHAT_SCOPES } from '@holo/sync-providers';

const threadsCursorSchema = z
  .object({
    /** Per-space `createTime` watermark (RFC 3339). */
    createdAfterPerSpace: z.record(z.string(), z.string()).default({}),
  })
  .default({ createdAfterPerSpace: {} });

/**
 * Resolve which spaces to sync. Prefers an explicit allowlist; falls back to
 * "all spaces the impersonated user is a member of" when no allowlist row is
 * set — Google Chat's own membership UI is the access boundary, requiring
 * admins to re-pick spaces here would be redundant friction. Mirrors Slack's
 * behaviour.
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
    // Default: every space the impersonated user is in. Skip DMs to avoid
    // ingesting private 1:1 chats by accident — admins can opt them in via
    // allowlist.
    return allSpaces.filter((s) => s.spaceType !== 'DIRECT_MESSAGE');
  }
}

export function createGoogleChatSpec(): ConnectorSpec {
  return defineConnector({
    id: 'google-chat',
    displayName: 'Google Chat',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER['google-chat'] },

    // The framework-bridge mints a fresh delegated access token before each
    // sync via Google's JWT bearer flow (loadGoogleServiceAccountToken) and
    // hands it to the spec via tokens.accessToken. The spec just attaches it
    // as a Bearer header — same shape as static-token connectors.
    auth: apiKey(),

    http: {
      baseUrl: 'https://chat.googleapis.com',
      defaultHeaders: { Accept: 'application/json' },
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // Google's userinfo endpoint identifies the impersonated user; Chat
      // itself has no /me. Use the email's domain as the workspace name proxy
      // so the dashboard shows something meaningful.
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
          fix: 'Verify the service account JSON key, impersonation email, and domain-wide delegation setup in Google Workspace Admin Console.',
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
