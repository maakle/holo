/**
 * Microsoft Graph v1.0 client for the Teams ingestion connector.
 *
 * Scope is deliberately narrow: only the endpoints the sync runner
 * needs (channel/chat message listing, delta cursor, member listing,
 * org+user lookup for ACL labels). Adding more = grow this file, not
 * a separate package.
 *
 * Auth: app-only via `loadTeamsBotAccessToken` with
 * `TEAMS_GRAPH_SCOPE`. Tokens are per-customer-tenant — see
 * `app-auth.ts` for the cache key rationale.
 *
 * Rate limits: Graph publishes 600 req/min per app per tenant for
 * Teams resources. The client honors `Retry-After` on 429 and
 * surfaces other 4xx/5xx as `HoloError(HOLO_CONNECTOR_HTTP)`.
 *
 * Pagination: `listFromUrl` walks `@odata.nextLink` until the page
 * with `@odata.deltaLink` (or end of collection). Delta links are
 * surfaced separately because the sync runner stores them in the
 * cursor; nextLinks are intra-run only.
 */
import { holoError, ErrorCode } from '@holo/errors';
import {
  loadTeamsBotAccessToken,
  TEAMS_GRAPH_SCOPE,
} from './app-auth';
import type {
  GraphChannel,
  GraphChat,
  GraphChatMessage,
  GraphCollection,
  GraphConversationMember,
  GraphOrganization,
  GraphTeam,
  GraphUser,
} from './graph-types';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
/** Default page size for message listings — Graph caps at 50. */
const DEFAULT_PAGE_SIZE = 50;
/** Sum of Retry-After waits we'll honor before giving up. */
const RETRY_BUDGET_MS = 60_000;

export interface TeamsGraphClientOptions {
  appId: string;
  appSecret: string;
  /** Customer AAD tenant GUID — tokens are scoped per tenant. */
  tenantId: string;
  fetchImpl?: typeof fetch;
}

export interface TeamsGraphClient {
  getOrganization(): Promise<GraphOrganization>;
  /** Teams the bot has been added to (RSC limits the result). */
  listJoinedTeams(): Promise<GraphTeam[]>;
  listTeamChannels(teamId: string): Promise<GraphChannel[]>;
  /**
   * First page of a channel's messages, ordered newest-first. Walk
   * `@odata.nextLink` for older history. When the listing transitions
   * to delta mode (initial sync completed), the final page carries
   * `@odata.deltaLink`.
   */
  listChannelMessages(
    teamId: string,
    channelId: string,
    opts?: { top?: number },
  ): Promise<GraphChannelMessagesPage>;
  /** Initial delta listing — call once per (team, channel) on first ingest. */
  channelMessagesDeltaInit(
    teamId: string,
    channelId: string,
  ): Promise<GraphChannelMessagesPage>;
  /**
   * Continue paging from an `@odata.nextLink` OR resume from a stored
   * `@odata.deltaLink`. Graph's contract: a nextLink within a delta
   * sequence is paged the same way; the *final* page of the sequence
   * carries the deltaLink to persist for next time.
   */
  fetchUrl<T>(url: string): Promise<T>;
  /** Chats the bot is installed in (RSC limits the result). */
  listChats(opts?: { top?: number }): Promise<GraphCollection<GraphChat>>;
  listChatMessages(
    chatId: string,
    opts?: { top?: number },
  ): Promise<GraphCollection<GraphChatMessage>>;
  chatMessagesDeltaInit(chatId: string): Promise<GraphCollection<GraphChatMessage>>;
  listTeamMembers(teamId: string): Promise<GraphConversationMember[]>;
  listChatMembers(chatId: string): Promise<GraphConversationMember[]>;
  getUser(aadObjectId: string): Promise<GraphUser | null>;
}

/** Page envelope returned by message listings. Alias kept for naming clarity at call sites. */
export type GraphChannelMessagesPage = GraphCollection<GraphChatMessage>;

export function createTeamsGraphClient(
  opts: TeamsGraphClientOptions,
): TeamsGraphClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function authedFetch<T>(
    url: string,
    init: RequestInit = {},
  ): Promise<T> {
    let spent = 0;
    while (true) {
      const { accessToken } = await loadTeamsBotAccessToken({
        appId: opts.appId,
        appSecret: opts.appSecret,
        tenantId: opts.tenantId,
        scope: TEAMS_GRAPH_SCOPE,
        fetchImpl,
      });
      const res = await fetchImpl(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      if (res.status === 429 || res.status === 503) {
        // Graph signals throttling via 429 (intentional) and
        // occasionally 503 (transient). Both carry Retry-After.
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const wait = Math.max(retryAfter, 1_000);
        if (spent + wait > RETRY_BUDGET_MS) {
          throw holoError({
            code: ErrorCode.HOLO_INGESTION_RATE_LIMITED,
            problem: `Microsoft Graph rate-limit budget exhausted (${res.status} from ${url})`,
            fix: 'Reduce concurrent Graph traffic; the connector honors Retry-After but exhausted its retry budget.',
          });
        }
        spent += wait;
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        // App-only auth should never hit 401 in steady state — token
        // cache misses re-mint. A 401 here usually means RSC consent
        // was revoked for this tenant. 403 = bot removed from the
        // resource. Everything else surfaces the body for triage.
        const detail = await res.text().catch(() => '');
        throw httpError(url, res.status, detail.slice(0, 500));
      }

      // 204 No Content from delete endpoints, etc. — return null cast.
      if (res.status === 204) return null as T;
      return (await res.json()) as T;
    }
  }

  return {
    async getOrganization() {
      const json = await authedFetch<{ value: GraphOrganization[] }>(
        `${GRAPH_BASE}/organization?$select=id,displayName`,
      );
      const first = json.value?.[0];
      if (!first) {
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: 'GET /organization returned an empty collection',
          fix: 'Verify the Azure AD app has consented permissions in the target tenant.',
        });
      }
      return first;
    },

    async listJoinedTeams() {
      // App-only `/teams` returns all teams in the tenant — *not* what
      // we want. Filtered via `/me/joinedTeams` is for delegated auth.
      // For RSC, the only way to enumerate "where bot is installed" is
      // via the membership graph: list teams where our bot's app id
      // appears in `installedApps`. Graph doesn't expose that filter
      // directly for app-only; instead, the sync runner relies on
      // `teams_installations` rows already populated by the bot's
      // inbound `conversationUpdate` handler (which is what tells us a
      // tenant has installed the app at all).
      //
      // For tenant-scoped enumeration after the bot has been added,
      // the safe approach is `/teams?$filter=installedApps/any(...)`
      // — but that filter requires `TeamsAppInstallation.ReadForUser`
      // which isn't in our RSC set.
      //
      // V1: fall back to listing all teams and let RSC enforce read
      // access; channels/messages calls return 403 for non-installed
      // teams which the sync runner catches and marks archived.
      const all = await collect<GraphTeam>(
        `${GRAPH_BASE}/teams?$select=id,displayName,description`,
      );
      return all;
    },

    async listTeamChannels(teamId) {
      return collect<GraphChannel>(
        `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels?$select=id,displayName,membershipType,description,webUrl`,
      );
    },

    async listChannelMessages(teamId, channelId, opts2) {
      const top = opts2?.top ?? DEFAULT_PAGE_SIZE;
      const url =
        `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}` +
        `/messages?$top=${top}`;
      return authedFetch<GraphChannelMessagesPage>(url);
    },

    async channelMessagesDeltaInit(teamId, channelId) {
      return authedFetch<GraphChannelMessagesPage>(
        `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages/delta`,
      );
    },

    async fetchUrl<T>(url: string) {
      return authedFetch<T>(url);
    },

    async listChats(opts2) {
      const top = opts2?.top ?? DEFAULT_PAGE_SIZE;
      return authedFetch<GraphCollection<GraphChat>>(
        `${GRAPH_BASE}/chats?$top=${top}&$select=id,topic,chatType,webUrl,lastUpdatedDateTime`,
      );
    },

    async listChatMessages(chatId, opts2) {
      const top = opts2?.top ?? DEFAULT_PAGE_SIZE;
      return authedFetch<GraphCollection<GraphChatMessage>>(
        `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages?$top=${top}`,
      );
    },

    async chatMessagesDeltaInit(chatId) {
      return authedFetch<GraphCollection<GraphChatMessage>>(
        `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages/delta`,
      );
    },

    async listTeamMembers(teamId) {
      const raw = await collect<{ id: string; displayName?: string; userId?: string; roles?: string[] }>(
        `${GRAPH_BASE}/teams/${encodeURIComponent(teamId)}/members`,
      );
      return raw;
    },

    async listChatMembers(chatId) {
      const raw = await collect<{ id: string; displayName?: string; userId?: string; roles?: string[] }>(
        `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/members`,
      );
      return raw;
    },

    async getUser(aadObjectId) {
      try {
        return await authedFetch<GraphUser>(
          `${GRAPH_BASE}/users/${encodeURIComponent(aadObjectId)}?$select=id,displayName,userPrincipalName,mail`,
        );
      } catch (err) {
        // 404 on guest users that have left the tenant; surface as null
        // so callers can fall back to the AAD oid as the display label.
        if (
          err &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: unknown }).code === ErrorCode.HOLO_FETCH_FAILED &&
          'problem' in err &&
          String((err as { problem: unknown }).problem).includes(' 404')
        ) {
          return null;
        }
        throw err;
      }
    },
  };

  async function collect<T>(initialUrl: string): Promise<T[]> {
    let url: string | undefined = initialUrl;
    const out: T[] = [];
    let pages = 0;
    while (url) {
      pages += 1;
      if (pages > 200) {
        // Hard safety cap. Real-world: a single channel rarely paginates
        // past ~20 pages; 200 means we're stuck in a loop.
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: `Graph collection exceeded ${pages - 1} pages — likely infinite paging loop`,
          fix: 'Inspect the @odata.nextLink chain at the source URL.',
        });
      }
      const page: GraphCollection<T> = await authedFetch(url);
      for (const item of page.value ?? []) out.push(item);
      url = page['@odata.nextLink'];
    }
    return out;
  }
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1_000;
  // Graph returns either seconds (integer) or an HTTP-date.
  const asInt = parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt > 0) return asInt * 1000;
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return 1_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function httpError(url: string, status: number, detail: string): Error {
  return holoError({
    code: ErrorCode.HOLO_FETCH_FAILED,
    problem: `Microsoft Graph ${status} from ${url}: ${detail}`,
    fix: status === 401
      ? 'Re-sideload holo-bot.zip in the target tenant to re-grant RSC permissions.'
      : status === 403
        ? 'The bot has been removed from this channel/chat or the tenant revoked consent.'
        : 'Inspect Graph logs (`Sign-ins → Service principal sign-ins` in Azure AD).',
  });
}
