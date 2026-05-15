/**
 * Microsoft Teams ingestion connector — registration spec.
 *
 * The actual sync work — Graph token mint, resource enumeration, delta
 * cursor walk, thread grouping — runs in the worker queue processor
 * (`apps/worker/src/queues/teams.ts`) against
 * `runTenantSync` from `./sync.ts`. The standard connector-framework
 * resource flow isn't engaged because:
 *
 *   1. Auth credentials are env-supplied (`TEAMS_BOT_APP_ID` +
 *      `TEAMS_BOT_APP_SECRET`) and shared across orgs — there's no
 *      per-org `connector_credentials.accessToken`.
 *   2. Tenant enumeration requires reading `teams_installations` from
 *      the DB; specs only have a narrow `ResourceSyncContext`.
 *
 * So this spec serves three purposes:
 *
 *   1. Make `'teams'` a known `ConnectorRegistration` so the bulk-status
 *      poll, the manage-sheet UI, and the standard scheduler all see it.
 *   2. Surface a `testConnection` that probes Graph reachability for
 *      the shared bot creds — used by the connections page "Verify
 *      deployment" button.
 *   3. Document the auth shape (`auth: none()`, with the spec internally
 *      minting tokens via `loadTeamsBotAccessToken`).
 *
 * Step 4b wires the worker-side processor to actually dispatch
 * `runTenantSync` against the standard scheduler.
 */
import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  defineConnector,
  none,
  type ConnectorSpec,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import { createTeamsGraphClient } from './graph-api';
import type { TeamsCursor } from './sync';

export interface TeamsSpecOptions {
  /** Microsoft App ID of the shared Holo bot (from `TEAMS_BOT_APP_ID`). */
  appId: string;
  /** Client secret of the shared Holo bot (from `TEAMS_BOT_APP_SECRET`). */
  appSecret: string;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * Cursor schema for the worker dispatcher (step 4b). Shape matches
 * `TeamsCursor` from `./sync.ts` — per-resource entry stored as JSONB.
 *
 * Marked as `passthrough` because the resource keys are dynamic
 * (`channel-<teamId>:<channelId>`, `chat-<chatId>`) and zod can't
 * enumerate them statically. The runtime parser in `./sync.ts`
 * (`parseStoredCursor`) does the real validation per entry.
 */
const teamsCursorSchema: z.ZodType<TeamsCursor> = z
  .record(z.string(), z.unknown())
  .transform((raw) => raw as TeamsCursor)
  .default({} as TeamsCursor);

export function createTeamsSpec(opts: TeamsSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'teams',
    displayName: 'Microsoft Teams',
    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.teams },

    // App-only Graph access. The connector mints its own tokens at sync
    // time via `loadTeamsBotAccessToken({ scope: TEAMS_GRAPH_SCOPE })`,
    // so the framework's per-org token plumbing stays out of the way.
    // Pattern matches mintlify (also `none()` — public surfaces).
    auth: none(),

    http: {
      // The framework-bridge's HttpClient is unused by this spec — we
      // talk to Graph through `createTeamsGraphClient` which owns its
      // own auth + retry path. Populating `baseUrl` so the framework's
      // testConnection ctx.api is constructible.
      baseUrl: 'https://graph.microsoft.com/v1.0',
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // Without a tenant id we can't pick a Graph endpoint to probe.
      // `testConnection` is mainly used at OAuth-callback time, which
      // doesn't apply to Teams (app-only auth, no per-user grant).
      // If a caller invokes this anyway, surface a useful error.
      const tenantId = (ctx.tokens as { tenantId?: unknown }).tenantId;
      if (typeof tenantId !== 'string') {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem:
            'Teams testConnection requires a tenantId on tokens — this connector uses app-only auth, not OAuth.',
          fix: 'Use `GET /api/connectors/teams/test` from the dashboard instead, which knows the tenant context.',
        });
      }
      const graph = createTeamsGraphClient({
        appId: opts.appId,
        appSecret: opts.appSecret,
        tenantId,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      const org = await graph.getOrganization();
      return {
        externalId: org.id, // AAD tenant GUID
        name: org.displayName,
        raw: { tenantId: org.id, displayName: org.displayName },
      };
    },

    resources: [
      {
        id: 'messages',
        displayName: 'Channel + chat messages',
        cursorSchema: teamsCursorSchema,
        // The framework's per-source-row sync flow isn't right for
        // Teams (one connection → many tenants → many channels/chats).
        // The worker processor (step 4b) calls `runTenantSync` directly,
        // bypassing this stub. Returning the cursor unchanged keeps
        // the framework happy if it ever picks up the job.
        async sync(ctx: ResourceSyncContext<TeamsCursor>): Promise<TeamsCursor> {
          return ctx.cursor;
        },
      },
    ],

    ui: {
      description:
        'Channels, chats, and threads from Microsoft Teams resources where the holo app is installed.',
      category: 'communication',
    },
  });
}
