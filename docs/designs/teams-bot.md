---
status: PLANNING
---
# Microsoft Teams Bot integration

Branch: `claude/microsoft-teams-app-integration` · Started: 2026-05-14

## Goal

Ship a Microsoft Teams bot that mirrors the conversational surface of the
existing Slack bot (and the now-planned Google Chat App): DM the bot for an
answer, @mention it in a channel or group chat, react 👍/👎 on its replies
to feed RFC-0008 quality signal. The agent core (`AgentImpl`, tools,
retrieval) is reused unchanged — this is an adapter, not a parallel agent.

This is the **bot/conversational** surface only. A read-only ingestion
connector for Teams chat history is a separate, future workstream and is
out of scope here (no schema overlap, no shared install).

## Non-goals

- Read-only ingestion of Teams chat history. The bot does not index past
  conversations; it answers from the org's existing corpus.
- Slash commands (Teams "messaging extensions" / `composeExtensions`) at
  launch. Defer to v2 — they need the same Bot Framework webhook plus a
  separate `commandLists` block in the app manifest.
- A Microsoft AppSource listing. Each customer sideloads the bot's app
  package (`.zip` of manifest + icons) via Teams Admin Center, parallel to
  the EE "bring your own Slack app" / "BYO Google Chat App" pattern.
- Tabs, dialogs (task modules), or meeting extensibility. Bot replies
  only.
- Adaptive Card v1.5-only features. Target v1.4 for broad compatibility
  with older Teams clients and Outlook actionable messages; v1.5
  enhancements layer on later.
- Microsoft Graph integration (e.g. resolving the asker's mailbox or
  calendar). The bot identifies users via Azure AD object id only.

## Background — what Teams gives us

Capability map vs. the existing Slack bot (and our Google Chat plan):

| Slack | Google Chat | Microsoft Teams |
|---|---|---|
| `app_mention` event | `MESSAGE` in `ROOM` | Bot Framework `Activity{type:'message'}` where `conversation.conversationType` is `channel` or `groupChat` and `entities[]` contains a `mention` of the bot |
| `message_im` event | `MESSAGE` in `DM` | `Activity{type:'message'}` where `conversation.conversationType === 'personal'` |
| `chat.postMessage` | `spaces.messages.create` | `POST {serviceUrl}/v3/conversations/{conversationId}/activities` |
| `chat.update` (placeholder → final) | `spaces.messages.patch` | `PUT {serviceUrl}/v3/conversations/{conversationId}/activities/{activityId}` |
| Thread replies via `thread_ts` | `thread.name` | Channel `conversation.id` already encodes the thread ID (`19:xxx@thread.tacv2;messageid=yyy`); reply to the same conversationId to stay in the thread |
| HMAC signature (`x-slack-signature`) | Google JWT in `Authorization: Bearer` against `chat@system.gserviceaccount.com` JWKS | Bot Framework JWT in `Authorization: Bearer`, issued by `https://api.botframework.com`, verified against OIDC metadata at `https://login.botframework.com/v1/.well-known/openidconfiguration` |
| Slack OAuth bot token | Google Cloud service account (app-level) | Outbound bearer token minted via `client_credentials` at `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token` with scope `https://api.botframework.com/.default` and the bot's Microsoft App ID + secret |
| `reaction_added` event | (Workspace Events API, deferred) | `Activity{type:'messageReaction'}` arrives in the same webhook — no separate subscription |
| 3s ack deadline | 30s sync ack deadline | **15s** sync ack deadline; longer work via proactive messaging (POST a fresh activity with the captured `serviceUrl` + `conversation.id`) |
| `team_id` tenant key | `customerNumber` | `channelData.tenant.id` (Azure AD tenant GUID) |

Three big differences worth calling out:

1. **`serviceUrl` is per-request.** Every inbound Activity carries a
   `serviceUrl` (e.g. `https://smba.trafficmanager.net/amer/`). The bot
   **must** use that exact URL for the outbound reply — it differs by
   region and may change. Microsoft's docs require us to trust the URL
   only after verifying it appears in the JWT's `serviceurl` claim. We
   store the most recently observed serviceUrl per (tenantId,
   conversationId) on the index row so proactive follow-ups (progress
   updates, errors) can patch later without reading the activity again.
2. **Reactions land in the same webhook.** Unlike Google Chat (where
   reactions need a separate Workspace Events subscription), Teams sends
   `messageReaction` activities to the same `/api/messages` endpoint.
   Means the v1 launch *can* include the RFC-0008 feedback loop.
3. **Two install paths, both customer-driven.** Either a Teams admin
   uploads the bot's `.zip` app package via Teams Admin Center → Manage
   apps → Upload custom app (per-tenant, no AppSource review), or
   individual users sideload it from the Teams desktop app if the tenant
   allows. AppSource publishing is a heavier follow-up. The bot
   credentials (Microsoft App ID + secret) are owned by Holo for the
   shared install; EE customers can register their own Azure AD app for
   the BYO path.

## Decisions locked this iteration

- **Webhook endpoint lives in `apps/gateway`**, not `apps/web`. Same
  rationale as Slack and Google Chat: gateway already owns inbound
  third-party event ingestion, JWT/signature verification, and the BullMQ
  enqueue path. Path: `POST /teams-bot/messages[/:orgId]`.
- **Shared Holo bot first, BYO-bot path second.** Same EE pattern. A
  single Azure AD app registration (the Holo bot) handles the SaaS
  install; EE customers can register their own Bot resource and store
  its `client_id`/`client_secret` per-org.
- **JWT verification using OIDC discovery.** We don't hardcode the JWKS
  URL — fetch `https://login.botframework.com/v1/.well-known/openidconfiguration`
  on first use, cache for 24h, follow the `jwks_uri` it returns. This
  matches Microsoft's published guidance and survives JWKS endpoint
  migrations. The expected audience is **the bot's Microsoft App ID**
  (GUID); the expected issuer is `https://api.botframework.com`.
  - **Important hardening**: the `serviceurl` claim must match
    `Activity.serviceUrl`. Without this check, an attacker who somehow
    obtained a forged token could redirect outbound replies to a
    controlled URL. Verify before enqueueing.
- **Dedupe key is `Activity.id`.** Microsoft retries on non-2xx, and
  `Activity.id` is stable across retries for the same delivery. Mirror
  Slack/Google Chat dedupe — same table shape, different column names.
- **Reuse the agent contract verbatim.** `AgentImpl` stays the same. The
  Teams handler builds the same `{ organizationId, userSubjects,
  question }` and consumes `AgentResult`.
- **Include reactions in v1.** Because Teams delivers reactions to the
  same endpoint, the RFC-0008 anchor + feedback row write lands at
  launch, not in a follow-up. Saves one round-trip of design churn.
  Because reactions ship at v1, the final answer card also includes the
  "React 👍/👎 to rate this answer" nudge — same UX as the Slack bot's
  `FEEDBACK_PROMPT` block added in commit `5b9e27c`. (Contrast with the
  Google Chat plan, where the prompt is deferred along with reactions
  themselves.)
- **Propagate `teamsAppConfigId` on the job from day 1.** Mirrors the
  recent Slack refactor in `aab16ce`: the gateway tags each enqueued
  job with the config row id (UUID for BYO, null for shared) so the
  worker can pick the matching credentials row for outbound posts.
  Cheap to bake in now. `teams_installations.tenant_id` is `UNIQUE` so
  the bug class isn't reachable at v1, but the hint is a
  forward-compatibility hedge: if we later relax the unique constraint
  to support a single tenant installed under multiple Holo orgs (e.g.
  a partner shell scenario), no job-payload migration is needed.
- **Surface Bot Connector failures via `logError`.** Same pattern the
  Slack bot adopted on main (`aab16ce`): pass an optional `logError`
  callback through `finalize.ts` / `progress.ts` / placeholder send so
  failed POSTs/PUTs to `serviceUrl` show up in worker logs rather than
  looking like a successful job that never produced a reply.
- **No Bot Framework SDK dependency.** The `botbuilder` npm packages are
  heavy and pin specific transports we don't need. We do raw HTTP for
  inbound (Hono route) and outbound (`fetch` against `serviceUrl`).
  Lifts ~1.5MB of optional deps and keeps the worker thin. The official
  SDK's value is in its state stores and conversational dialog graph —
  irrelevant for a stateless answer-and-reply bot.
- **Adaptive Cards v1.4 dialect.** Document the version up top in
  `cards.ts`; v1.5 enhancements (e.g. compound buttons) come later.
- **No proactive notifications.** The bot only responds to inbound
  activities. The proactive messaging path is wired (we capture
  `serviceUrl`+`conversation.id` for progress patches) but no scheduled
  send.
- **No SSO.** Teams supports `OAuthCard` for SSO sign-in flows; out of
  scope. The bot answers any user @mention without auth-gating per-user.
  Same as Slack/Google Chat.

## Architecture

### Request path

```
Teams ─POST(JWT)─▶ /teams-bot/messages[/:orgId]   (apps/gateway)
                       │
                       │ 1. verifyTeamsJwt() against OIDC-discovered JWKS,
                       │    audience = bot app id, iss = api.botframework.com,
                       │    serviceurl claim == Activity.serviceUrl
                       │ 2. resolveOrgFromTenant() — tenant.id → organizationId
                       │    (or :orgId for BYO)
                       │ 3. tryClaimTeamsActivity(tenant_id, activity_id)
                       │ 4. enqueueTeamsBotJob({ activityId, conversationId,
                       │    serviceUrl, ... })
                       ▼
                BullMQ: queue=teams-bot
                       │
                       ▼
       apps/worker/src/teams-bot/processor.ts
                       │
                       ▼
                 handleTeamsBotJob(...)
                       │ resolveWorkspace() → org + bot app creds
                       │ createTeamsApiClient({ appId, appSecret, serviceUrl })
                       │ post placeholder Adaptive Card
                       │ run AgentImpl (unchanged)
                       │ PUT placeholder activity with final card
                       │ insert into teams_answer_index for RFC-0008
                       ▼
            POST/PUT {serviceUrl}/v3/conversations/.../activities
```

### Module layout

New code, mirrors the Slack and Google-Chat-App layout 1:1.

```
apps/gateway/src/teams-bot/
  messages.ts        # POST /teams-bot/messages[/:orgId]
  dedupe.ts          # tryClaimTeamsActivity(tenantId, activityId)
  queue.ts           # TeamsBotJob union, enqueue helper
  verify.ts          # JWT verify wrapper (calls into connector helper)

apps/worker/src/teams-bot/
  teams-bot.module.ts
  teams-bot.processor.ts
  handler.ts                 # dispatch on job.kind
  agent-runner.ts            # re-exports shared AgentImpl factory from slack-bot
  cards.ts                   # Adaptive Card v1.4 builders
  finalize.ts                # placeholder → PUT activity + error fallback
  progress.ts                # PUT-driven progress updates (throttled)
  workspace.ts               # tenantId → org + bot creds
  feedback-reaction.ts       # messageReaction → answer_feedback (RFC-0008)
  text.ts                    # strip <at>botname</at> mention tags, normalize HTML

packages/connectors/src/teams/
  app-api.ts          # createConversation, sendActivity, updateActivity
  app-auth.ts         # client_credentials token mint + cache
  app-verify-jwt.ts   # OIDC discovery + JWKS cache + verify
  app-types.ts        # Activity envelope, Adaptive Card v1.4 shapes
  manifest.ts         # generate app manifest.json (build the zip in admin UI)
  index.ts            # re-exports

apps/web/src/app/api/connectors/teams-bot/
  bot-status/route.ts
  installations/route.ts          # list tenants the bot is in
  configure/route.ts              # EE: paste App ID + secret for BYO bot
  manifest/route.ts               # download the per-org app package (.zip)
```

Note: this is a brand-new directory in `packages/connectors/src/`, not a
sub-package of an existing Teams ingestion connector (none exists). All
Teams-related code lives under `teams/`, but we use `app-` prefixed
filenames to leave room for a future read-only ingestion sibling without
namespace collision (same pattern as `google-chat/app-*.ts`).

### Job types

```ts
// apps/worker/src/teams-bot/handler.ts

/**
 * `teamsAppConfigId` mirrors the slack_app_config_id hint introduced for
 * Slack BYO disambiguation: null = shared Holo bot route, UUID = the
 * teams_app_configs row id from the per-org BYO route. Required on every
 * variant from day 1 so the worker never has to guess which bot's
 * credentials to mint outbound tokens against.
 */
type TeamsAppConfigHint = { teamsAppConfigId: string | null };

export type TeamsBotJob =
  | ({
      kind: 'mention';            // Activity{type:'message'} in channel/groupChat with bot mention
      tenantId: string;           // AAD tenant GUID
      activityId: string;         // Activity.id (dedupe key)
      conversationId: string;     // includes thread ID in channels
      serviceUrl: string;         // verified to match JWT serviceurl claim
      asker: string;              // from.aadObjectId (or from.id fallback)
      askerName?: string;         // from.name (display)
      text: string;               // textPayload, mention tags stripped
    } & TeamsAppConfigHint)
  | ({
      kind: 'dm';                 // personal 1:1
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      askerName?: string;
      text: string;
    } & TeamsAppConfigHint)
  | ({
      kind: 'reaction';
      tenantId: string;
      activityId: string;         // the reaction Activity's own id (dedupe)
      conversationId: string;
      serviceUrl: string;
      asker: string;
      // replyToId points at the bot's message that received the reaction;
      // the worker looks it up in teams_answer_index.
      replyToId: string;
      reactionType: string;       // 'like' | 'heart' | 'laugh' | 'surprised' | 'sad' | 'angry'
      removed: boolean;           // true for `reactionsRemoved`, false for `reactionsAdded`
    } & TeamsAppConfigHint);
```

### DB additions

Three new tables (Teams reuses no Slack tables despite shared shape, same
choice we made for Google Chat). One migration.

```ts
// EE BYO bot — Azure AD app registration per org.
teams_app_configs (
  id uuid pk,
  organization_id uuid unique not null fk -> organization(id),
  // Bot's Microsoft App ID (GUID) — registered at https://dev.botframework.com or via Azure Bot resource.
  app_id text not null,
  // Client secret created in Azure Portal → App registrations → Certificates & secrets.
  app_secret encrypted_text not null,
  // Optional: AAD tenant the app is scoped to. Empty for multi-tenant apps (most common for BYO).
  app_tenant_id text,
  display_name text,
  created_by_user_id uuid fk -> user(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

// Maps an installed Teams tenant to a Holo org. Written by the
// onboarding flow when the bot receives its first ADDED_TO_TEAM-style
// `conversationUpdate` (membersAdded includes bot id), or pre-populated
// by the connections wizard.
teams_installations (
  id uuid pk,
  organization_id uuid not null fk -> organization(id),
  tenant_id text not null,
  // Display name of the AAD tenant (e.g. "Contoso Corp"). Best-effort —
  // we capture it from the install activity for the admin UI's "the bot
  // is installed in N tenants" surface.
  tenant_display_name text,
  installed_at timestamptz default now() not null,
  unique (tenant_id)  // one tenant → exactly one org (see note below)
);
// Note: the unique-on-tenant_id constraint is the cheap version of the
// `aab16ce`/`21a6de6` Slack disambiguation work. Slack's `sources` table
// is NOT unique on (provider, externalId), so a single Slack workspace
// can be installed under multiple Holo orgs and resolveWorkspace must
// join sources ⨝ connector_credentials with a slack_app_config_id
// filter to route correctly. For Teams we hold the line: one tenant
// tenants exactly one org. If we ever relax this, the
// `teamsAppConfigId` hint on TeamsBotJob is already in place — only
// the `resolveTeamsWorkspace` query needs to change (single LEFT JOIN
// on teams_installations + teams_app_configs, filter by hint).

teams_event_dedupe (
  tenant_id text not null,
  activity_id text not null,
  received_at timestamptz default now() not null,
  primary key (tenant_id, activity_id)
);

// RFC-0008 anchor: maps a Teams-side message we posted back to an answer
// row, so a future messageReaction activity can become a feedback row.
teams_answer_index (
  organization_id uuid not null fk -> organization(id),
  answer_id uuid not null primary key fk -> answer(id),
  tenant_id text not null,
  conversation_id text not null,
  // Activity ID of the bot reply — matches Activity.replyToId on a reaction.
  activity_id text not null,
  // Captured at reply time so reaction handling doesn't have to round-trip
  // an HTTP call to figure out where to post a follow-up.
  service_url text not null,
  question text not null,
  answer text not null,
  sources_jsonb jsonb not null,
  created_at timestamptz default now() not null
);
```

Unique indexes: `(tenant_id, conversation_id, activity_id)` on
`teams_answer_index` so the reaction lookup is a single seek.

### HTTP routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /teams-bot/messages` | JWT verify (shared bot app id) | Shared Holo bot inbound |
| `POST /teams-bot/messages/:orgId` | JWT verify (per-org app id from `teams_app_configs`) | EE BYO-bot inbound |
| `GET /api/connectors/teams-bot/bot-status` | session | "Is the bot reachable in this tenant?" |
| `GET /api/connectors/teams-bot/installations` | session | List installed tenants (for connections page) |
| `POST /api/connectors/teams-bot/configure` | session, EE-gated | Paste Microsoft App ID + secret for BYO setup |
| `GET /api/connectors/teams-bot/manifest` | session | Download generated `holo-bot.zip` (manifest + icons) |

### JWT verification

```
1. Read Authorization: Bearer <jwt> from request.
2. Decode header → kid.
3. On cold cache: GET https://login.botframework.com/v1/.well-known/openidconfiguration
   to discover the JWKS URL. Cache for 24h. (Per Microsoft's docs the
   metadata document and JWKS URL can change; OIDC discovery is the
   stable contract.)
4. Verify RS256 signature against the kid'd key.
5. Verify iss === 'https://api.botframework.com'.
   Some channels emit `https://api.botframework.com/` (trailing slash);
   accept both. (Open question — validate during Step 3.)
6. Verify aud === <bot's Microsoft App ID> for shared route, or the
   per-org app_id from teams_app_configs for BYO.
7. Verify exp > now, nbf <= now (with small clock skew).
8. Verify the `serviceurl` claim (when present) matches
   Activity.serviceUrl exactly. If the claim is absent on a channel,
   reject — Microsoft's compliance bots are required to fail closed.
9. Reject otherwise; 401 with a logged reason.
```

### Adaptive Card format

Two card sends per turn:

1. **Placeholder card** — single `TextBlock` widget, "_holo is
   thinking…_", attached to a fresh outbound activity. Capture the
   returned `id` for the update.
2. **Final card** — answer text + a "Sources" section with up to N
   clickable links via `Action.OpenUrl` widgets (Teams renders these as
   inline buttons). On error, swap in the equivalent of
   `ERROR_FALLBACK_TEXT` from the Slack bot.

`cards.ts` exports `placeholderCard()`, `answerCard({ answer, sources })`,
`errorCard()`. Same surface as the Google Chat bot.

Reply threading in channels works automatically: posting to the same
`conversation.id` (which already encodes the thread ID) keeps the reply
in-thread.

## Sequencing

Each step is a separately reviewable PR.

### Step 1 — Azure registration + manifest (no application code)

- Create an Azure AD app registration (multi-tenant) at
  https://portal.azure.com → App registrations.
- Create an Azure Bot resource (or skip if using the legacy Bot Framework
  Portal) pointing at our messaging endpoint URL.
- Generate a client secret, store in `WORKER_TEAMS_BOT_APP_SECRET`;
  record the App ID in `WORKER_TEAMS_BOT_APP_ID`.
- Author the Teams app manifest (`manifest.json`) + 192×192 and 32×32
  PNG icons. Zip them as `holo-bot.zip`.
- Sideload into our test tenant via Teams Admin Center → Manage apps →
  Upload custom app.

Risk: getting the manifest schema wrong is a slow loop (Teams Admin
upload errors are unhelpful). Burn through it before writing code.

### Step 2 — DB migration

Add the four tables above. Single Drizzle migration. Wire FKs the same
way `slack_app_configs` does (org cascade, user set-null). Don't forget
the snapshot file alongside the SQL — CI's `db:check` enforces it.

### Step 3 — Inbound: JWT verify + dedupe + enqueue

- `packages/connectors/src/teams/app-verify-jwt.ts` — OIDC discovery,
  JWKS cache, RS256 verify, aud/iss/exp/nbf + serviceurl-claim check.
- `apps/gateway/src/teams-bot/messages.ts` — routes, raw body read,
  verify, dedupe, enqueue, ack.
- `apps/gateway/src/teams-bot/dedupe.ts`, `queue.ts`.
- Unit tests (mirror the JWT verify suite from
  `packages/connectors/test/google-chat-app-verify-jwt.test.ts`):
  - valid token + valid activity → enqueues
  - valid token + duplicate activityId → does not enqueue
  - invalid signature → 401, no DB write
  - wrong audience → 401
  - expired token → 401
  - missing Authorization → 401
  - serviceurl claim mismatch → 401  ← Teams-specific case
  - `iss` with trailing slash variant → accepted

### Step 4 — Worker: minimal handler (no agent, no Teams API yet)

- BullMQ processor reads `TeamsBotJob` and logs it.
- Wire `apps/worker/src/teams-bot/teams-bot.module.ts` into the worker
  module graph.
- Smoke: send a DM to the bot in the test tenant, confirm a job lands in
  BullMQ with the expected shape.

### Step 5 — Outbound: Teams API client + cards

- `packages/connectors/src/teams/app-auth.ts` —
  `loadTeamsBotAccessToken({ appId, appSecret })` returns a fresh
  `client_credentials` token (scope
  `https://api.botframework.com/.default`) with ~55 min cache. Token
  endpoint URL is fixed:
  `https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token`.
- `packages/connectors/src/teams/app-api.ts` — `sendActivity` (POST to
  `${serviceUrl}/v3/conversations/{conversationId}/activities`),
  `updateActivity` (PUT `.../activities/{activityId}`).
  Don't normalize trailing slashes in `serviceUrl` — Microsoft's docs
  warn that some channels expect the slash to be preserved.
- `apps/worker/src/teams-bot/cards.ts` — three builders, Adaptive
  Card v1.4 dialect.
- Handler posts placeholder, sleeps, updates with hard-coded "hello" —
  validates round-trip.

### Step 6 — Wire to agent

- `apps/worker/src/teams-bot/agent-runner.ts` re-exports
  `makeDefaultAgentRunner` from the Slack module. The agent contract is
  provider-agnostic; copy the re-export pattern used in the Google
  Chat plan.
- `handler.ts` builds `userSubjects = ['org:${organizationId}']` and
  calls the runner.
- Progress updates: `progress.ts` patches the placeholder activity at
  the same 750ms cadence as Slack/Google Chat.
- `recordAgentEvent` calls with `kind: 'slack_message'` (legacy enum
  reuse — long-overdue rename to `chat_message` is filed as a follow-up
  in the Google Chat spec).
- Strip `<at>holo</at>` mention spans from `text` before passing to the
  agent. Teams puts the mention as both an `entities[].mention` and a
  literal `<at>` tag in the message body.

### Step 7 — RFC-0008: answer index + reaction handler

- After the final activity update succeeds, insert into
  `teams_answer_index` keyed by `(organization_id, answer_id)`.
- `feedback-reaction.ts` mirrors `slack-bot/feedback-reaction.ts`:
  - `messageReaction` activity with `reactionsAdded` → lookup the bot
    message in `teams_answer_index` by `replyToId`, write an
    `answer_feedback` row.
  - `reactionsRemoved` → delete the row.
  - Map Teams reaction names to `-1 | 0 | 1`:
    `like|heart|laugh` → 1, `sad|angry` → -1, `surprised` → 0 (no clear
    polarity; or omit from the mapping and skip).

### Step 8 — Admin UI surface

- Connections page card: "Microsoft Teams bot" with bot-status
  indicator, installed-tenants count, and EE "configure custom bot"
  CTA.
- `GET /api/connectors/teams-bot/manifest` returns a generated
  `holo-bot.zip` containing `manifest.json` (with the org's bot app
  id) + the two icons. We construct the zip in-memory with `jszip`.
- Reuse the existing connector card components.

### Step 9 — End-to-end testing in the test tenant

Manual checklist (also in the PR description):

- DM the bot in 1:1 chat with a known-good question → placeholder card
  appears → updates to answer card → source buttons clickable.
- @mention the bot in a public channel → reply threads correctly.
- @mention in a group chat → reply lands in the group chat.
- Empty mention ("just @holo") → friendly prompt, no agent call.
- Bot's own messages don't re-trigger (filter `from.id === bot.id` or
  use `recipient.id` check at the gateway).
- Tenant not connected → log line, no crash, no reply attempted.
- JWT replay (token reused 6+ minutes later) → rejected.
- Reaction added to bot reply → `answer_feedback` row written.
- Reaction removed → row deleted.
- Channel mention in a **private channel** → still works (private
  channels use a different conversationId prefix but the same activity
  contract).

### Step 10 — Docs

- New `docs/connectors/teams-bot.md` (note: no read-only ingestion doc
  exists yet — the bot doc is standalone).
- Customer install flow:
  1. Download the `.zip` from the connections page.
  2. Teams Admin Center → Manage apps → Upload custom app.
  3. Approve the install.
  4. Add the bot to a team/channel/DM.
- Operator runbook: secret rotation (regenerate Azure AD client secret
  → update worker env → restart) and how to revoke an install.

### Step 11 (post-launch) — AppSource publication

Optional follow-up: submit the bot to Microsoft AppSource for one-click
install. Requires Microsoft Partner account + Publisher Attestation +
$/several weeks of review. We don't block v1 on it.

## Risks and unknowns

- **`serviceurl` claim presence and shape**. Microsoft's docs say
  emerging compliance bots must verify it, but the claim format
  (whether trailing slash, whether url-encoded) varies across versions.
  Validate at Step 3 with real captured tokens from the test tenant
  before pinning a comparison strategy.
- **Issuer canonicalization** — see above; trailing slash vs no slash.
- **OIDC metadata cache invalidation**. If Microsoft rotates keys
  during a 24h cache window, signature verification will fail until the
  cache expires. Mitigation: on a verification failure that includes a
  `kid` mismatch, force-refresh the JWKS once before returning 401.
- **Rate limits on the Bot Connector API**. Microsoft documents
  ~1800 messages/30s per bot per channel. Bot quota is shared across
  all tenants on the shared install — under heavy fan-out this could
  starve. The throttled progress wrapper at 750ms is already
  conservative; document a follow-up to surface 429 retry budgeting.
- **App manifest schema drift**. Teams manifest schemas version every
  few months (1.13 / 1.14 / 1.16 currently in flight). Pin to a
  conservative version (1.13 or 1.14) and document the bump policy.
- **Multi-tenant Azure AD app vs single-tenant**. The shared Holo bot
  must be multi-tenant; the BYO path can be either. Document this in
  the EE setup docs — a single-tenant BYO app won't receive activities
  from outside its home tenant.
- **Customer-owned Azure tenant for BYO**. EE customers need to be
  willing to register an Azure AD app and a Bot resource in their own
  subscription. Heavier than Slack's "create an app at api.slack.com"
  flow; document carefully.
- **Reaction polarity for `surprised`**. Teams' six built-in reactions
  don't all map cleanly to thumbs-up/down. Punt: only `like`, `heart`,
  `laugh` map to +1 and `sad`, `angry` to -1; everything else is
  ignored. Matches Slack's "unknown emoji → skip" policy.

## Out of scope (explicitly)

- Slash / messaging-extension commands (`composeExtensions` in the
  manifest).
- Tabs, dialogs (task modules), meeting extensibility.
- Stage view actions / O365 connectors / Outlook actionable messages.
- Microsoft Graph integration (resolving asker's mailbox, calendar,
  presence).
- SSO via `OAuthCard`.
- AppSource publication for v1.
- Searching across Teams chat history from inside the bot — that's a
  future read-only ingestion connector, not in this plan.
- Per-user ACL gating (the bot answers using the org's full corpus,
  same convention as Slack and Google Chat).

## Rough effort estimate

- Steps 1–3 (Azure setup, schema, inbound verify+enqueue): ~1.5 days.
  The Azure setup alone is a few hours of point-and-click; the
  `serviceurl` verification logic is the biggest unknown.
- Steps 4–6 (worker, outbound, agent wiring): ~2 days.
- Step 7 (RFC-0008 + reactions): ~half a day. Reactions are in-band,
  so this is a lot simpler than the Google Chat plan would be.
- Step 8–9 (admin UI + manifest zip + E2E): ~1 day.
- Step 10 (docs): ~half a day.

Total to v1 launch: ~5.5 working days assuming no major surprises in
JWT verification or manifest authoring. Slightly longer than Google
Chat because reactions are in-scope and Azure manifest authoring has a
longer feedback loop than Google's Cloud Console.

## Cross-references

- Slack bot (existing): `apps/{gateway,worker}/src/slack*/`,
  `packages/connectors/src/slack/`.
- Google Chat App bot (planned + partially implemented):
  `docs/designs/google-chat-app.md`.
- Agent contract (shared, provider-agnostic):
  `apps/worker/src/slack-bot/agent-runner.ts` — `AgentImpl`.
- RFC-0008 (quality feedback loop):
  `docs/rfcs/0008-quality-feedback-loop.md`.
