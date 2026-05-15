---
status: PLANNING
---
# Microsoft Teams ingestion connector

Branch: `claude/teams-ingestion-design` · Started: 2026-05-15

## Goal

Ship a read-only Microsoft Teams connector that indexes chat history into
Holo's corpus, so the conversational Teams bot (and every other holo
surface: web chat, Slack bot, Google Chat bot, MCP clients) can retrieve
from Teams threads the same way they retrieve from Slack threads.

This is the **ingestion** sibling of the existing conversational bot
(`docs/designs/teams-bot.md`, shipped in PR #196 + #199). The two share
the Azure AD app registration and the `packages/connectors/src/teams/`
folder but otherwise have no runtime overlap: the bot uses Bot Framework
tokens to send replies, ingestion uses Microsoft Graph tokens to read
history.

The same shape as Google Chat: `docs/connectors/google-chat-app.md` is
the bot, `docs/connectors/google-chat.md` is ingestion.

## Non-goals

- **File attachments, OneDrive files, SharePoint pages.** Files shared in
  Teams chats live in OneDrive — out of scope here; covered (or not) by
  a separate Microsoft 365 connector. The Teams chunker ignores
  attachment refs at v1.
- **Meeting transcripts, recordings, call captions.** Different Graph
  surface (`/communications/callRecords`), different storage, different
  PII risk profile. Worth a separate connector if/when customers ask.
- **Presence, calendar, availability.** Bot doesn't need it; retrieval
  doesn't need it; would require additional Graph permissions with
  weaker ACL semantics.
- **Reactions, mentions, message reactions as feedback signal.** The
  bot's RFC-0008 path already covers feedback collection from Teams; we
  don't ingest end-user reactions on third-party messages here.
- **Channel/team membership change events.** We don't need a webhook
  subscription; pull-only sync. The bot's existing
  `conversationUpdate` handler tells us when the bot was added or
  removed from a resource.
- **Per-channel allowlist UI at v1.** The RSC permission model is
  *already* a per-channel allowlist — the bot is only granted to read
  what was explicitly installed in. Adding a Holo-side toggle on top is
  redundant friction. Defer to v2 if a customer wants finer scoping
  within an installed team.
- **Microsoft Teams Premium features** (loop components, message
  metadata extensions). Best-effort: the chunker preserves what Graph
  hands us; we don't probe for richer payloads.

## Background — what Microsoft Graph gives us

Capability map vs. existing chat ingestion connectors:

| Slack | Google Chat | Microsoft Teams (this design) |
|---|---|---|
| OAuth bot token, scopes `channels:history` + `groups:history` | Service account with domain-wide delegation, `chat.spaces.readonly` + `chat.messages.readonly` | Azure AD app + **Resource-Specific Consent** (RSC) declared in the Teams app manifest |
| `conversations.list` + `conversations.history` + `conversations.replies` | `spaces.messages.list` (delegated) | `/teams/{teamId}/channels/{channelId}/messages[/{messageId}/replies]` + `/chats/{chatId}/messages` |
| `users.list` for user directory | `users.get` per author | `/users/{aadObjectId}` (cached) |
| Incremental sync by `oldest` ts watermark | Incremental sync by Google `pageToken` | **Delta cursor** via `/.../messages/delta?$select=...` — Graph's native incremental endpoint |
| Membership: bot in channel | Bot in space (post-launch Workspace Events) | RSC restricts visibility to installed resources at the Graph layer; no runtime filter needed |
| Rate limit: tier-based per method | ~600 req/min per project | 600 req/min per app per tenant; 429 with `Retry-After` |

Three big differences worth calling out:

1. **The Teams app manifest is the access boundary.** RSC permissions
   (`ChannelMessage.Read.Group`, `ChatMessage.Read.Chat`, etc.) declared
   under `authorization.permissions.resourceSpecific[]` give the bot
   read access **only** to channels/chats where an admin sideloaded it.
   No tenant-wide read powers. This is materially safer than the
   `Chat.Read.All` application permission (which sees every chat in
   the tenant — overbroad).
2. **Delta cursor is first-class.** Graph's `/messages/delta` endpoint
   returns a `@odata.deltaLink` that captures incremental state across
   sync runs. Slack and Google Chat don't have this — we cursor with
   per-channel watermarks. Teams gets a proper resumable token, which
   handles edits and deletes natively.
3. **One Azure AD app, two scopes.** The bot already minted
   `https://api.botframework.com/.default` tokens (PR #196). Ingestion
   mints `https://graph.microsoft.com/.default` tokens against the
   **same** App ID + secret. No new env vars; reuse
   `TEAMS_BOT_APP_ID` + `TEAMS_BOT_APP_SECRET`. We parameterize
   `loadTeamsBotAccessToken` to take a scope.

## Decisions locked this iteration

- **Auth: Resource-Specific Consent, not application-wide.** Concretely:
  the manifest declares `authorization.permissions.resourceSpecific[]`
  with `ChannelMessage.Read.Group`, `ChatMessage.Read.Chat`,
  `TeamSettings.Read.Group`, `TeamMember.Read.Group`,
  `ChatMember.Read.Chat`. Admin grants per-install at sideload time;
  Microsoft enforces the boundary; we never see chats the bot isn't in.
- **Reuse `packages/connectors/src/teams/`**, not a sibling folder.
  Per-file prefix convention: `app-*.ts` for bot files (already there),
  `graph-*.ts` for ingestion. Shared utils stay un-prefixed.
- **Single Azure AD app for bot + ingestion.** Customer admins
  consented to the bot's manifest at install time; we update the
  manifest to add the ingestion RSC permissions and bump the version.
  **Existing installs require a one-time re-sideload** to grant the new
  permissions — Teams Admin Center prompts the admin on re-upload.
- **No per-user OAuth.** The Holo user who toggled ingestion in the
  dashboard does not need a Teams session. App-only Graph access via
  client_credentials means the connection lives at the Azure AD app
  layer, not per-user. Aligns with the bot's existing auth shape.
- **Delta cursor over watermark cursor.** Per-resource (channel or
  chat) `@odata.deltaLink` stored in `connector_cursors.metadata`.
  Falls back to `?$top=50&$orderby=createdDateTime desc` for the
  initial backfill, then promotes to delta on completion.
- **One connector spec, two resource types.** `defineConnector({ id:
  'teams', resources: [{ id: 'channel-messages' }, { id:
  'chat-messages' }] })`. Both consume `graph-thread-chunker.ts` but
  with different path-fn prefixes (`/teams/<team>/<channel>` vs.
  `/teams/chats/<chat-label>`).
- **ACL derivation is per-resource, not per-user.** Channel posts get
  `acl_subjects = ['org:<orgId>', 'team:<aadTeamId>']`; chat messages
  get `['org:<orgId>', 'chat:<chatId>']`. Retrieval upper-bounds: a
  user only sees Teams content if their `user_subjects` includes a
  matching team or chat subject — which the `user-subjects` package
  derives from `/me/joinedTeams` + chat membership.
- **No DM-from-bot ingest.** The bot's own DM threads with users are
  technically chats the app is installed in; skip them. Filter by
  `chatType !== 'oneOnOne'` OR by detecting the bot as the other
  participant.
- **Skip `system` event messages.** Graph returns
  `messageType: 'systemEventMessage'` rows for "user joined channel,"
  "topic changed," etc. These aren't substantive content; drop at the
  chunker.
- **Reuse the universal sync surface.** No new tables.
  `connector_credentials` (one row per (org, teams)), `sources` (one
  per indexable Teams resource — team-channel or chat),
  `source_artifacts` (one per Teams thread/message-tree), `chunks`
  (one or more per artifact). Same shape as Slack and Google Chat.

## Architecture

### Auth flow

```
Admin sideloads holo-bot.zip (new version, with RSC perms in manifest)
   │
   ▼  Teams renders consent prompt:
      "holo needs to read channel & chat messages in resources where
       it's installed"
   │  Admin clicks Allow → grant recorded against AAD app per resource.
   ▼
Holo worker sync run:
   ├─ loadTeamsBotAccessToken({ appId, appSecret,
   │      scope: 'https://graph.microsoft.com/.default' })
   ├─ enumerate installed resources:
   │    GET /teams                          (returns teams where bot is added)
   │    GET /teams/{id}/channels            (returns channels in those teams)
   │    GET /chats                          (RSC scopes the result to where
   │                                          bot is installed)
   ├─ for each resource:
   │    upsert into sources
   │    if no delta-link:  GET /.../messages?$top=50    (backfill)
   │    else:              GET <deltaLink>              (incremental)
   │    upsert into source_artifacts (one per thread)
   │    chunk + embed
   │    store new deltaLink in connector_cursors
   ▼
Done. Bot, web chat, Slack bot, MCP — all see Teams threads via search.
```

### Module layout

```
packages/connectors/src/teams/
  app-api.ts                 ← unchanged (bot outbound)
  app-auth.ts                ← parameterize scope; add GRAPH_SCOPE constant
  app-types.ts               ← unchanged
  app-verify-jwt.ts          ← unchanged
  graph-api.ts               (new) — Graph HTTP client
  graph-types.ts             (new) — Channel, Chat, ChatMessage, Team types
  graph-pagination.ts        (new) — @odata.nextLink + @odata.deltaLink helpers
  spec.ts                    (new) — defineConnector({ id: 'teams', ... })
  sync.ts                    (new) — runChannelMessagesSync, runChatMessagesSync
  index.ts                   ← re-export the new helpers

packages/chunker/src/
  teams-thread.ts            (new) — chunker for a Teams thread
                                     (one parent message + replies)

packages/sync-providers/src/
  index.ts                   ← append 'teams' to SYNC_PROVIDERS;
                               'teams-sync' to QUEUE_NAMES_BY_PROVIDER

apps/worker/src/queues/
  teams.ts                   (new) — TeamsSyncModule + processor

apps/web/src/app/api/connectors/teams/
  status/route.ts            (new) — last sync, installed resources count
  configure/route.ts         (new) — POST: enable ingestion for this org
                                     (writes connector_credentials row)
```

### Manifest changes

Append to the generated manifest in
`apps/web/src/lib/teams-bot/manifest.ts`:

```jsonc
{
  // ... existing fields ...

  "webApplicationInfo": {
    "id": "{TEAMS_BOT_APP_ID}",
    "resource": "https://RscBasedStoreApp"  // placeholder per MS docs
  },
  "authorization": {
    "permissions": {
      "resourceSpecific": [
        // Channel ingestion
        { "name": "ChannelMessage.Read.Group", "type": "Application" },
        { "name": "TeamSettings.Read.Group", "type": "Application" },
        { "name": "TeamMember.Read.Group", "type": "Application" },
        // Chat ingestion (1:1 + group + meeting chats where bot is added)
        { "name": "ChatMessage.Read.Chat", "type": "Application" },
        { "name": "ChatMember.Read.Chat", "type": "Application" }
      ]
    }
  }
}
```

Bump the manifest `version` field (date scheme already in place
auto-bumps on each generate). Existing customers re-download the zip and
re-upload it; Teams Admin Center detects the new RSC permissions and
prompts the admin to re-consent on the in-place update.

We add a banner in the dashboard's Teams card when an org's earliest
ingest sync run is older than the manifest version that introduced RSC,
to nudge admins toward the re-upload. (Inferred from the absence of a
`teams_graph_consented_at` row in the connector_credentials metadata.)

### Schema additions

**None.** Reusing the universal sync surface entirely.

- `connector_credentials` — one row per (org, `provider='teams'`).
  `accessToken` left empty (app-only mints fresh per sync). `metadata`
  carries the `graphConsentedAt: ISO date` so the dashboard knows when
  the admin re-consented to the RSC permissions.
- `sources` — one row per indexable Teams resource. Two `kind` values:
  - `channel-messages` → `externalId = "<aadTeamId>/<channelId>"`
  - `chat-messages` → `externalId = "<chatId>"`
  - `metadata` has `team_id`, `team_display_name`, `channel_id`,
    `channel_display_name` (for channels); `chat_id`, `chat_topic`,
    `chat_type` (`'oneOnOne'|'group'|'meeting'`) for chats.
- `source_artifacts` — one row per thread (= one root message + its
  replies). `externalId = "<resourceExternalId>:<rootMessageId>"`.
  `kind = 'teams-thread'`. `payload` jsonb stores the raw Graph
  envelope for replayability.
- `chunks` — one or more per artifact (a long thread may exceed the
  embedding window). `acl_subjects` derived per-resource (see below).
- `connector_cursors` — one row per (org, source). `metadata.deltaLink`
  carries the Graph delta token; `metadata.backfillCompletedAt` flips
  the connector from initial-pull to delta-pull mode.

### Path-fn / url-fn registrations

```ts
// packages/chunker/src/path-fn.ts
'teams-thread': ({ metadata, externalId }) => {
  const kind = metadata.resource_kind; // 'channel' | 'chat'
  if (kind === 'channel') {
    const team = slug(metadata.team_display_name, slug(metadata.team_id, 'unknown'));
    const channel = slug(metadata.channel_display_name, slug(metadata.channel_id, 'unknown'));
    const date = dateFromGraphIso(metadata.created_date_time);
    const root = slug(metadata.root_message_id, slug(externalId, 'thread'));
    return `/teams/${team}/${channel}/${date}/${root}.md`;
  }
  // chat: /teams/chats/<chat label>/<thread root>.md
  const chat = slug(metadata.chat_topic, slug(metadata.chat_id, 'chat'));
  const root = slug(metadata.root_message_id, slug(externalId, 'thread'));
  return `/teams/chats/${chat}/${root}.md`;
}

// packages/chunker/src/url-fn.ts
'teams-thread': ({ metadata }) => {
  // Graph returns the user-facing deep link in message.webUrl. We persist
  // it on the parent message at chunk time so the url-fn can read it back
  // without round-tripping Graph.
  return str(metadata.web_url) ?? null;
}
```

### Chunker design — `teams-thread.ts`

Mirrors `slack-thread.ts` and `google-chat-thread.ts`:

- **Input shape:** `{ rootMessage, replies[], participantAadObjectIds[],
  resourceKind: 'channel' | 'chat', resourceLabel, webUrl,
  userDirectory: Map<aadOid, displayName> }`.
- **Output:** one chunk if the thread fits the embedding window;
  recursive-split into multiple chunks otherwise (same affordance as
  Slack).
- **Content format:** `@<Display Name> [HH:MM]: <text>` lines, one
  message per line. HTML messages (Teams' `body.contentType === 'html'`)
  are stripped to plain text with a simple tag-stripper — full markdown
  conversion is out of scope; the LLM tolerates raw text fine.
- **ACL subjects:**
  - Channel thread → `['org:<orgId>', 'team:<aadTeamId>']`
  - Chat thread → `['org:<orgId>', 'chat:<chatId>']`
  - Per-user ACL via the user-subjects package, which queries
    `/me/joinedTeams` + chat membership and caches via the existing
    `user_subjects_cache` table.
- **System events skipped:** filter out `messageType:
  'systemEventMessage'` and `'unknownFutureValue'` at chunker entry.

### Sync flow

Per resource (channel or chat), per sync run:

```
1. cursor = connector_cursors.metadata for this source
   if cursor.deltaLink:
       url = cursor.deltaLink
       mode = 'delta'
   else:
       url = `/teams/{teamId}/channels/{channelId}/messages?$top=50&$orderby=createdDateTime desc`
       mode = 'backfill'

2. for each page:
   GET url
   on 429: respect Retry-After, exponential backoff
   on 401: this should never happen in app-only mode; surface and bail
   on 403 (chat/channel removed from bot): mark source as
     `archived_at = now()`, stop syncing
   for each message in page:
     if messageType in ['systemEventMessage', 'unknownFutureValue']: skip
     if message.deleted: hard-delete the artifact + chunks
     if message.replyToId:  group under parent thread
     else:                  create new thread
   url = response.@odata.nextLink or response.@odata.deltaLink

3. when @odata.deltaLink appears:
   if mode === 'backfill':
     mark backfillCompletedAt; switch to delta on next run.
   store deltaLink in connector_cursors.metadata
```

Threads are flushed to the database when:
- The next page's first message has a different `replyToId` chain (no more replies coming).
- OR after `MAX_THREAD_BUFFER = 200` replies (defensive cap).
- OR at end of sync.

### Connector spec

```ts
export function createTeamsSpec(opts: TeamsSpecOptions): ConnectorSpec {
  return defineConnector({
    id: 'teams',
    displayName: 'Microsoft Teams',
    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.teams },

    // App-only auth. The framework's `none()` strategy is the right
    // primitive: the spec mints its own Graph token at sync time, the
    // framework just shuttles whatever `accessToken` it sees in tokens.
    // Mirrors the existing GitHub App pattern.
    auth: none(),

    http: { baseUrl: 'https://graph.microsoft.com/v1.0' },

    async testConnection(ctx) {
      // GET /organization returns the tenant we're consented in.
      const client = createTeamsGraphClient({
        appId: opts.appId,
        appSecret: opts.appSecret,
      });
      const org = await client.getOrganization();
      return {
        externalId: org.id,         // AAD tenant GUID
        name: org.displayName,
        raw: { tenantId: org.id },
      };
    },

    resources: [
      { id: 'channel-messages', displayName: 'Channel messages',
        async sync(ctx) { return runChannelMessagesSync(ctx, opts); } },
      { id: 'chat-messages', displayName: 'Chat messages',
        async sync(ctx) { return runChatMessagesSync(ctx, opts); } },
    ],
  });
}
```

### Dashboard surface

A new card on the connections page, parallel to Slack/Google Chat
ingestion cards:

- **Header:** "Microsoft Teams" + connection status pill
- **States:**
  - **Bot not installed yet** — link to the bot setup card
    (`/connect#chat-bot`). Ingestion requires the bot's manifest to
    be sideloaded with RSC perms.
  - **Bot installed but no RSC grant** — yellow banner: "Re-sideload
    the bot to grant new ingestion permissions" + link to dashboard's
    manifest download.
  - **Connected** — last-sync timestamp; counts of
    `installed in N teams, M chats`.
- **Actions:** "Enable ingestion" (writes connector_credentials row);
  "Pause ingestion" (toggle); "Disconnect" (removes credentials, drops
  sources + chunks via the existing disconnect job).

No allowlist UI at v1 — RSC already does the per-resource gating.

## Sequencing

Each step is a separately reviewable PR.

### Step 1 — Manifest update + migration plan (small PR)

- Edit `apps/web/src/lib/teams-bot/manifest.ts` to declare the five RSC
  permissions under `authorization.permissions.resourceSpecific[]`.
- Bump the manifest's `version` semantically (date scheme already does
  this automatically per request).
- Add a UI banner on the bot card: "Re-sideload the holo app package to
  enable Teams ingestion."
- Docs: `docs/connectors/teams-bot.md` § "Upgrading from bot-only to
  bot+ingestion" — re-sideload steps for admins.

Why first: zero code-path risk; admins can start re-consenting before
the rest ships.

### Step 2 — Graph client + auth scope param (small PR)

- Parameterize `loadTeamsBotAccessToken(scope?: string)` (default stays
  the bot scope for backwards compat). Add `TEAMS_GRAPH_SCOPE` constant.
- New file `packages/connectors/src/teams/graph-api.ts` — `fetch`-based
  client with `listTeams`, `listChannels`, `listChannelMessages`,
  `listChats`, `listChatMessages`, `getUser`, `getOrganization`.
- New file `packages/connectors/src/teams/graph-types.ts` — Graph
  response shapes (Team, Channel, ChatMessage, …).
- Unit tests: mock fetch, verify pagination handling + 429 retry +
  delta-link detection.

### Step 3 — Chunker + path-fn / url-fn registrations (small PR)

- `packages/chunker/src/teams-thread.ts` — paralleling
  `slack-thread.ts` / `google-chat-thread.ts`. Tests for: HTML
  stripping, system-event filtering, ACL derivation, recursive split
  on long threads.
- Append `'teams-thread'` entries to `path-fn.ts` + `url-fn.ts`.

### Step 4 — Schema wiring + spec + sync runners (large PR)

- Append `'teams'` to `SYNC_PROVIDERS`; add `'teams-sync'` to
  `QUEUE_NAMES_BY_PROVIDER`.
- `packages/connectors/src/teams/spec.ts` — `createTeamsSpec(...)`.
- `packages/connectors/src/teams/sync.ts` — `runChannelMessagesSync`
  and `runChatMessagesSync` (delta-link cursoring, 429 handling,
  thread grouping, deletion handling).
- Worker queue + processor.
- Integration test: stub Graph with a fixed delta sequence, verify the
  full pipeline produces expected `source_artifacts` + `chunks` rows
  with correct ACL.

### Step 5 — Dashboard UI (small PR)

- `apps/web/src/app/api/connectors/teams/{status,configure,disconnect}/route.ts`
- `apps/web/src/components/connectors/teams-card.tsx` (or wherever
  connector cards live by then).
- Doc: `docs/connectors/teams.md` (the ingestion sibling of
  `docs/connectors/teams-bot.md`) — admin setup, retention semantics,
  troubleshooting.

### Step 6 — User-subjects derivation for Teams ACL (small PR)

- `packages/user-subjects/src/teams.ts` — query
  `/users/{aadObjectId}/joinedTeams` + `/users/{aadObjectId}/chats`
  via Graph for each holo user; cache in `user_subjects_cache`.
- This is what makes ACL filtering work at retrieval time: a user can
  only see Teams content for teams/chats they're a member of in AAD.

### Step 7 — Operator E2E + docs polish

- Manual smoke against a real tenant.
- Update `docs/connectors/teams-bot.md` § "Out of scope" to remove the
  "no ingestion" line.

## Risks and unknowns

- **RSC re-consent UX.** Admins who installed the bot pre-ingestion
  must re-sideload. Some tenants have strict app-approval policies
  that make re-upload a multi-day process; the dashboard banner
  surfaces the requirement clearly, but it's still friction.
- **Graph rate limits.** 600 req/min per app per tenant for Teams
  resources. For a large tenant with dozens of channels and chats,
  initial backfill can throttle. Need per-tenant token-bucket pacing
  in `graph-api.ts` — copy the slack-api.ts pattern.
- **Delta link expiry.** Graph delta links expire after ~30 days of
  non-use. On 410 Gone, fall back to backfill (re-list, then
  re-acquire a delta link). Document the symptom and fallback.
- **Message edits.** Graph delta surfaces edits via `@odata.removed`
  on the old version + a new entry. The chunker must upsert by
  `(source_id, externalId)` to handle this; same shape as Slack edits.
- **HTML content.** Some clients post rich HTML (Outlook actionable
  messages, Power Automate flows). A naive tag-stripper handles the
  common case; complex tables / embedded cards degrade to "user posted
  a card" text. Document the failure mode.
- **`oneOnOne` chats with the bot itself.** Filter at sync entry so we
  don't ingest the bot's own conversation history.
- **AAD users without join history.** A user who was added to a team
  via an external invite can still post — verify Graph returns them
  in `participants` and that the user-subjects derivation includes
  them.
- **Private channel membership leakage.** Channel ACL must be
  per-channel (not per-team) for private channels. Graph's
  `Channel.membershipType === 'private'` is the discriminator;
  emit `acl_subjects` accordingly. Tests must cover this.
- **Bot removed from a resource.** When an admin removes the bot from
  a channel, the next sync sees `403 Forbidden`. Mark the `source` as
  archived, stop syncing, but **don't** delete existing chunks — they
  represent already-consented-and-indexed history that the bot can
  legitimately retrieve until a separate purge.

## Out of scope (explicitly)

- File attachments / OneDrive files / SharePoint pages.
- Meeting transcripts, recordings, call captions.
- Reactions as feedback signal beyond what RFC-0008 already collects.
- Presence / calendar / availability.
- Webhook subscriptions for real-time membership changes.
- Per-channel allowlist UI inside an installed team.
- Microsoft Teams Premium features (loop components, message metadata
  extensions beyond what Graph hands us by default).
- Cross-tenant federation (B2B guests viewing content from a partner
  tenant). Graph returns these messages; the ACL story for them is a
  separate design.

## Rough effort estimate

- Step 1 (manifest + re-sideload docs): ~half a day.
- Step 2 (Graph client + auth param): ~1 day.
- Step 3 (chunker + registrations): ~1 day.
- Step 4 (schema wire + spec + sync runners): ~2 days. Biggest single
  PR. Delta-link state machine + thread grouping are the hard parts.
- Step 5 (dashboard UI): ~half a day.
- Step 6 (user-subjects derivation): ~half a day.
- Step 7 (E2E + docs): ~half a day.

Total to v1: ~5.5–6 working days. Slightly longer than the bot work
because of the delta-cursor state machine, the re-consent migration,
and the per-user-subjects ACL plumbing.

## Cross-references

- Teams bot (already shipped): `docs/designs/teams-bot.md`,
  `docs/connectors/teams-bot.md`.
- Parallel: Google Chat ingestion (`docs/connectors/google-chat.md`)
  is the closest existing shape — also bot + ingestion sharing a
  connector folder.
- Slack ingestion (`packages/connectors/src/slack/spec.ts`) is the
  template for the connector-framework wiring.
- Microsoft Graph docs:
  - https://learn.microsoft.com/graph/teams-concept-overview
  - https://learn.microsoft.com/microsoftteams/platform/graph-api/rsc/resource-specific-consent
  - Channel messages delta:
    https://learn.microsoft.com/graph/api/chatmessage-delta
