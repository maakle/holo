---
status: PLANNING
---
# Google Chat App (bot) integration

Branch: `claude/google-chat-app-integration-sLwnj` · Started: 2026-05-14

## Goal

Ship a Google Chat App that mirrors the conversational surface of the
existing Slack bot: DM the bot for an answer, @mention it in a space, and
react 👍/👎 on its replies to feed RFC-0008 quality signal. The agent core
(`AgentImpl`, tools, retrieval) is reused unchanged — this is an adapter,
not a parallel agent.

## Non-goals

- Read-only ingestion of Google Chat history. That's already shipped as a
  separate connector (`docs/connectors/google-chat.md`, service account +
  DWD). The bot and the ingestion connector live side by side; neither
  replaces the other.
- Slash commands at launch. Google Chat slash commands require Marketplace
  publishing or per-tenant app configuration; defer to v2.
- A Google Workspace Marketplace listing. Each customer registers their
  own Chat app in their Cloud project pointing at our public endpoint
  (mirrors the EE "bring your own Slack app" path).
- Rich Cards v2 fidelity parity with Slack Block Kit. Launch with text +
  basic source links; richer cards come after the loop closes.

## Background — what the Slack bot does today

Files (counts approximate, see `git ls-files`):

- **Gateway** `apps/gateway/src/slack/` — `events.ts`, `commands.ts`,
  `dedupe.ts`, `queue.ts`. HMAC-verifies inbound webhooks, dedupes by
  `(team_id, event_id)`, enqueues a typed BullMQ job, acks within 3s.
- **Worker** `apps/worker/src/slack-bot/` — `slack-bot.processor.ts`
  (NestJS BullMQ processor), `handler.ts` (dispatch on `kind`),
  `agent-runner.ts` (`AgentImpl` injection point), `agent.ts` (the
  Anthropic loop), `blocks.ts` / `finalize.ts` / `progress.ts` (message
  formatting), `feedback-reaction.ts` (RFC-0008 emoji → feedback row).
- **Connectors SDK** `packages/connectors/src/slack/` — `api.ts`
  (chat.postMessage / chat.update), `verify-signature.ts` (HMAC),
  `manifest.ts` (app manifest for the shared Holo app).
- **OAuth / admin UI** `apps/web/src/app/api/connectors/slack/` —
  callback, channels, bot-status.
- **DB schema** `packages/db/src/schema/connectors.ts` — `slack_app_configs`
  (per-org BYO app creds, EE), `slack_event_dedupe` (idempotency),
  `slack_answer_index` (anchor for emoji feedback).

The Slack adapter is already cleanly separated from the agent. `AgentImpl`
in `agent-runner.ts:9-15` takes `{ db, organizationId, userSubjects,
question, progress }` and returns `AgentResult`. Nothing Slack-specific
crosses that boundary.

## What Google Chat gives us

Capability map vs. Slack:

| Slack | Google Chat |
|---|---|
| `app_mention` event | `MESSAGE` event in a `ROOM`-type space (bot's display name appears in `message.annotations[].userMention`) |
| `message_im` event | `MESSAGE` event in a `DM`-type space |
| `chat.postMessage` | `spaces.messages.create` |
| `chat.update` (placeholder → final) | `spaces.messages.patch` |
| Thread replies via `thread_ts` | `thread.name` or `thread.threadKey` on create; `messageReplyOption=REPLY_MESSAGE_OR_FAIL` |
| HMAC signature (`x-slack-signature`) | Bearer JWT in `Authorization`, verified against Google's published JWKS, audience = our project number |
| Slack OAuth bot token | Google Cloud **service account** (JWT-bearer auth, no per-tenant token storage for the shared app) |
| `reaction_added` event | `spaces.messages.reactions` — emoji reactions exist; events fire as `MESSAGE`-related but reaction-specific event support requires the Chat API "ReactionAdded" event subscription (Workspace Events API) |
| 3s ack deadline | **30s** sync ack deadline (more headroom — we can post a placeholder in the same response) |
| `team_id` tenant key | `space.name` (`spaces/AAAA…`) + Workspace customer ID (`customerNumber` in the bot's request) |

Two big differences worth calling out:

1. **No per-user OAuth.** The bot identifies as its own service account.
   Authorization to *answer* must happen at the Workspace level: we map an
   inbound space → Holo organization the same way the read-only connector
   already does (via the workspace's `customerNumber` / domain). One row
   per (customerNumber, organizationId).
2. **Reactions are a separate subscription.** Slack hands us reactions as
   plain events; Google Chat reactions go through the Workspace Events
   API with a separate `subscriptions.create` call. Treat the reaction
   path as a follow-on, not part of the v1 launch checklist.

## Decisions locked this iteration

- **Webhook endpoint lives in `apps/gateway`**, not `apps/web`. Matches the
  Slack adapter — the gateway already owns inbound third-party event
  ingestion, signature verification, and the BullMQ enqueue path.
- **Shared Holo app first, BYO-app path follows.** Same EE pattern as
  Slack: a single Cloud project hosts the shared app for SaaS customers;
  EE customers can register their own Chat app per org and point it at
  `/google-chat/events/:orgId`. The shared app row resolves auth via the
  worker's service-account JSON in env; per-org rows resolve via
  `google_chat_app_configs`.
- **JWT verification, not shared secret.** Google Chat does not offer a
  Slack-style signing-secret HMAC. Every inbound request carries a Bearer
  JWT issued by Google with audience = our Cloud project number, signed
  by Google's rotating keys at
  `https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com`.
  Fail closed if the JWT is absent, expired, or audience-mismatched.
- **Dedupe key is `(space_name, message.name)`.** Google Chat retries on
  3xx/5xx; `message.name` (`spaces/AAA/messages/BBB`) is stable per
  delivery. Mirror the Slack `event_dedupe` table.
- **Reuse the agent contract verbatim.** `AgentImpl` stays the same.
  The Google Chat handler builds the same `{ organizationId, userSubjects,
  question }` and consumes `AgentResult`. No agent code moves.
- **Reactions deferred.** Land DM + @mention first, ship, then add
  reactions via Workspace Events subscription in a follow-up. Quality
  loop continues to work in Slack until then.
- **No slash commands at launch.** Google Chat slash commands require app
  config — defer until BYO-app is the documented path or we publish.
- **No Marketplace listing.** Shared app stays restricted to our test
  Workspace; customers go through the BYO-app path documented like the
  existing read-only connector docs.

## Architecture

### Request path

```
Google Chat ─POST(JWT)─▶ /google-chat/events[/:orgId]   (apps/gateway)
                              │
                              │ 1. verifyChatJWT() against Google JWKS
                              │ 2. resolveOrgFromSpace() — customerNumber →
                              │    organizationId (or :orgId for BYO)
                              │ 3. tryClaimChatEvent(spaceName, messageName)
                              │ 4. enqueueChatBotJob(...)
                              ▼
                       BullMQ: queue=google-chat-bot
                              │
                              ▼
              apps/worker/src/google-chat-bot/processor.ts
                              │
                              ▼
                        handleChatBotJob(...)
                              │ resolveWorkspace() → org + service account creds
                              │ createChatApiClient(...)
                              │ post placeholder card
                              │ run AgentImpl (unchanged)
                              │ patch placeholder with final card
                              │ insert into chat_answer_index (RFC-0008 anchor)
                              ▼
                        spaces.messages.patch
```

### Module layout

New code, mirrors the Slack layout 1:1 so cross-referencing stays cheap.

```
apps/gateway/src/google-chat/
  events.ts          # POST /google-chat/events[/:orgId]
  dedupe.ts          # tryClaimChatEvent(spaceName, messageName)
  queue.ts           # ChatBotJob union, enqueue helper
  jwt.ts             # verifyChatJWT, JWKS cache

apps/worker/src/google-chat-bot/
  google-chat-bot.module.ts
  google-chat-bot.processor.ts
  handler.ts                # dispatch on job.kind
  agent-runner.ts           # re-export shared AgentImpl factory
  cards.ts                  # Cards v2 message builders
  finalize.ts               # placeholder → final patch + error fallback
  progress.ts               # patch-driven progress updates
  workspace.ts              # resolve customerNumber/space → org + creds
  feedback-reaction.ts      # (v2) reaction → feedback row

packages/connectors/src/google-chat/
  app-api.ts          # spaces.messages.{create,patch}, reactions.list (v2)
  verify-jwt.ts       # JWT verification + JWKS cache
  manifest.ts         # JSON for the Chat API "Configuration" tab
  types.ts            # Inbound event envelope, Cards v2 shapes
  index.ts            # re-exports

apps/web/src/app/api/connectors/google-chat-app/
  bot-status/route.ts
  spaces/route.ts            # list spaces the bot is in (admin UI)
  configure/route.ts         # EE: paste service-account JSON for BYO app
```

Note: the existing `packages/connectors/src/googlechat/` (read-only
ingestion) stays untouched. New code goes under `google-chat/` (hyphen)
to keep the boundary obvious in imports. Worth a short comment in each
package's `index.ts` to point future readers at the right one.

### Job types

```ts
// apps/worker/src/google-chat-bot/handler.ts
export type ChatBotJob =
  | {
      kind: 'mention';            // MESSAGE in a ROOM space, bot mentioned
      customerNumber: string;     // Workspace tenant key
      spaceName: string;          // spaces/AAA
      threadName: string;         // spaces/AAA/threads/BBB
      messageName: string;        // spaces/AAA/messages/CCC
      asker: string;              // users/UUU
      text: string;
    }
  | {
      kind: 'dm';                 // MESSAGE in a DM space
      customerNumber: string;
      spaceName: string;
      threadName?: string;        // DMs may or may not be threaded
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      // v2 — added when Workspace Events reaction subscription lands.
      kind: 'reaction';
      customerNumber: string;
      spaceName: string;
      messageName: string;
      asker: string;
      emoji: string;
      removed: boolean;
    };
```

### DB additions

New tables, all in `packages/db/src/schema/connectors.ts`. One migration.

```ts
// Shared Holo app: zero rows needed (service account creds in env).
// BYO app per org — EE only, mirrors slack_app_configs.
google_chat_app_configs (
  id uuid pk,
  organization_id uuid unique not null fk -> organization(id),
  // Service account JSON (encrypted). Used to mint bearer tokens for
  // outbound Chat API calls. Must include client_email + private_key.
  service_account_json encrypted_text not null,
  // Google Cloud project number used as the JWT audience for inbound
  // verification. Required — without it we can't validate JWTs.
  audience text not null,
  display_name text,
  created_by_user_id uuid fk -> user(id) on delete set null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

// Maps a Chat workspace (customerNumber) to a Holo org. For the shared
// app this is the primary tenant lookup; for BYO it's redundant with the
// app_config row but keeps the resolver shape consistent across both.
google_chat_workspaces (
  id uuid pk,
  organization_id uuid not null fk -> organization(id),
  customer_number text not null,
  // The bot's space membership in this workspace — useful for admin UI
  // ("the bot is in N spaces here").
  spaces_count int default 0,
  created_at timestamptz default now() not null,
  unique (customer_number)  // one workspace tenants exactly one org
);

// Idempotency: Google Chat retries on 5xx (and occasionally 3xx).
google_chat_event_dedupe (
  space_name text not null,
  message_name text not null,
  claimed_at timestamptz default now() not null,
  primary key (space_name, message_name)
);

// RFC-0008 anchor: maps a Chat-side message we posted back to an answer
// row so a future reaction can become a feedback row.
google_chat_answer_index (
  organization_id uuid not null fk -> organization(id),
  answer_id uuid not null primary key fk -> answer(id),
  space_name text not null,
  message_name text not null,
  question text not null,
  answer text not null,
  sources_jsonb jsonb not null,
  created_at timestamptz default now() not null
);
```

### HTTP routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /google-chat/events` | JWT verify (shared aud) | Shared Holo app events |
| `POST /google-chat/events/:orgId` | JWT verify (per-org aud from `google_chat_app_configs`) | EE BYO-app events |
| `GET /api/connectors/google-chat-app/bot-status` | session | Admin UI: is the bot reachable in this workspace |
| `GET /api/connectors/google-chat-app/spaces` | session | List spaces the bot is in (for the connections page) |
| `POST /api/connectors/google-chat-app/configure` | session, EE-gated | Paste service-account JSON for BYO setup |

### JWT verification

```
1. Read Authorization: Bearer <jwt> from request.
2. Decode header → kid.
3. Fetch JWKS from cached https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com
   (cache TTL 1h, refresh on kid miss; same shape as Better-Auth's
   JWKS handling — reuse if it's already imported, otherwise add `jose`).
4. Verify RS256 signature against the kid'd key.
5. Verify iss === 'chat@system.gserviceaccount.com'.
6. Verify aud === <our Cloud project number> for the shared route, or
   <project number stored on the per-org app_config> for BYO.
7. Verify exp > now, nbf <= now.
8. On any failure: 401, log reason. Never JSON-parse the body before
   verifying — Google signs the request, not just the body, so re-read
   the raw body the same way we do for Slack HMAC.
```

### Card / message format

Two messages per turn:

1. **Placeholder card** — single text widget, "Holo is looking…", posted
   with `messageReplyOption=REPLY_MESSAGE_OR_FAIL` so it threads under
   the asker's message (in rooms) or appends to the DM. Capture the
   returned `message.name` for progress updates.
2. **Final card** — answer text + a "Sources" section with up to N
   clickable source links. Patch the placeholder via
   `spaces.messages.patch`. On error, patch with the equivalent of
   `ERROR_FALLBACK_TEXT` from `apps/worker/src/slack-bot/blocks.ts:1`.

`cards.ts` exports `placeholderCard()`, `answerCard({ answer, sources })`,
`errorCard()`. Keep the surface narrow — no buttons, no chips, no
images for v1. Cards v2 dialect; document the choice up top so readers
don't reach for v1.

## Sequencing

Each step is a separately reviewable PR.

### Step 1 — Cloud project + service account (no code)

- Create a dedicated GCP project (`holo-chat-app-prod`).
- Enable Chat API + Workspace Events API.
- Create a service account; download JSON; store in `WORKER_GOOGLE_CHAT_APP_CREDENTIALS_JSON`.
- Configure the Chat app (Application name, avatar, app URL, **interactive features ON**, HTTP endpoint = `${GATEWAY_PUBLIC_URL}/google-chat/events`).
- Add app to our test Workspace.
- Record the **project number** (audience) in `GOOGLE_CHAT_APP_PROJECT_NUMBER`.

Risk: project misconfiguration costs the cheapest of any step — burn
through it before writing code.

### Step 2 — DB migration

Add the four tables above. Single Drizzle migration. Wire foreign keys
the same way `slackAppConfigs` does (`onDelete: 'cascade'` from
organization).

### Step 3 — Inbound: JWT verify + dedupe + enqueue

- `packages/connectors/src/google-chat/verify-jwt.ts` (JWKS cache, RS256, aud/iss/exp/nbf).
- `apps/gateway/src/google-chat/events.ts` (routes, raw body read, verify, dedupe, enqueue, ack).
- `apps/gateway/src/google-chat/dedupe.ts`, `queue.ts`.
- Unit tests:
  - valid JWT + valid event → enqueues
  - valid JWT + duplicate message → does not enqueue
  - invalid signature → 401, no DB write
  - wrong audience → 401
  - expired token → 401
  - missing Authorization header → 401

### Step 4 — Worker: minimal handler (no agent, no Chat API yet)

- BullMQ processor reads `ChatBotJob` and logs it.
- Wire `apps/worker/src/google-chat-bot/google-chat-bot.module.ts` into the worker module graph.
- Smoke: send a DM in the test Workspace, confirm a job lands in BullMQ with the expected shape.

### Step 5 — Outbound: Chat API client + cards

- `packages/connectors/src/google-chat/app-api.ts` —
  `createChatApiClient(serviceAccountJson)` returning
  `{ createMessage, patchMessage }`. Service account JWT bearer auth;
  scope = `https://www.googleapis.com/auth/chat.bot`.
- `apps/worker/src/google-chat-bot/cards.ts` — three builders.
- Handler posts placeholder, sleeps, patches with hard-coded "hello" —
  validates round-trip.

### Step 6 — Wire to agent

- `apps/worker/src/google-chat-bot/agent-runner.ts` re-exports
  `makeDefaultAgentRunner` from the Slack module (or move it to a
  shared `apps/worker/src/agent-runner/` — preferred if the move is
  surgical, otherwise re-export and circle back).
- `handler.ts` builds `userSubjects = [`org:${organizationId}`]` and
  calls the runner, mirroring `slack-bot/handler.ts:108`.
- Progress updates: `progress.ts` patches the placeholder with phase
  text, same cadence as Slack.
- `recordAgentEvent` calls with `kind: 'chat_message'` (new) so the
  observability UI groups Chat turns separately from Slack ones.

### Step 7 — RFC-0008 anchor

- After the final patch succeeds, insert into `google_chat_answer_index`
  keyed by `(organization_id, answer_id)` with `(space_name, message_name)`.
- Conflict policy: `onConflictDoNothing` on `answer_id` like Slack.
- Reaction handling stays deferred; this just makes the future hook-up
  trivial.

### Step 8 — Admin UI surface

- Connections page card: "Google Chat app" with bot-status indicator,
  "spaces the bot is in" count, and (EE) "configure custom app" CTA.
- `apps/web/src/app/api/connectors/google-chat-app/` routes per the
  table above.
- Reuse the existing connector card components; no new design needed.

### Step 9 — End-to-end testing in the test Workspace

Manual checklist (also covered in the PR description):

- DM the bot with a known-good question → placeholder appears →
  patches to answer → sources clickable.
- @mention the bot in a room → reply threads under the mention.
- Empty message ("just @bot") → friendly prompt, no agent call.
- Bot's own messages don't re-trigger (Chat sets `message.sender.type =
  BOT` on bot-originated messages — filter at the gateway).
- Workspace not connected → log line, no crash, no reply attempted.
- JWT replay (5s old token) → rejected.

### Step 10 — Docs

- New `docs/connectors/google-chat-app.md` (note: distinct from the
  existing `google-chat.md` for the read-only connector — link both
  ways).
- BYO-app setup: project number for audience, service account JSON,
  endpoint URL, scopes.
- Operator runbook entry: how to add the bot to a customer's
  Workspace, how to revoke.

### Step 11 (post-launch) — Reactions for RFC-0008

- Workspace Events API subscription on the bot's spaces for
  `google.workspace.chat.reaction.v1.created` and `.deleted`.
- New `ChatBotJob` kind `reaction`.
- Reuse `feedback-reaction.ts` shape from Slack with a Chat-flavored
  index lookup.

## Risks and unknowns

- **JWKS shape.** Google's Chat-bot JWKS endpoint is documented as a
  certs JSON, not a JWKS. We may need to convert the x509 certs to JWKS
  in-process, or use the alternate
  `https://www.googleapis.com/oauth2/v3/certs` endpoint if it covers
  the same key set. **Validate during Step 3** before committing to a
  verification library.
- **Audience semantics for BYO apps.** A BYO app may set its own
  audience; confirm in Cloud Console docs that we can pin the expected
  audience per-org. If not, fall back to verifying issuer + signature
  only on the BYO route, with the documented warning.
- **Threading in DMs.** Slack threads DMs the same as channels; Chat's
  thread model in 1:1 DMs is subtler — replies may show as flat. Pick a
  consistent behavior and document it in `handler.ts`.
- **Workspace → org mapping for the shared app.** First inbound event
  from a new Workspace has no `google_chat_workspaces` row. Decision:
  reject with a friendly card pointing to the connections page, exactly
  like Slack's `workspace_not_connected` path. Admin then completes the
  mapping in the dashboard.
- **Service-account key rotation.** Document the rotation procedure for
  the shared app credentials; the worker reads from env, so rotation
  requires a redeploy. Acceptable for v1.

## Out of scope (explicitly)

- Slash commands (`/holo …`).
- Buttons / interactive cards / dialogs.
- File attachments.
- Per-user OAuth (Chat App identity stays the bot).
- Searching across Google Chat history from inside the bot — that's the
  existing read-only connector's job, surfaced via the agent's retrieval
  tools.
- Workspace Marketplace publishing.

## Rough effort estimate

- Steps 1–3 (project, schema, inbound): ~1 day.
- Steps 4–6 (worker, outbound, agent wiring): ~2 days.
- Steps 7–8 (RFC-0008 anchor, admin UI): ~1 day.
- Step 9–10 (test + docs): ~1 day.
- Step 11 (reactions, post-launch): ~half a day.

Total to v1 launch: ~5 working days assuming no major surprises in
JWT verification (the biggest unknown).
