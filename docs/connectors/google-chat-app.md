# Google Chat App (conversational bot)

> Distinct from `google-chat.md`, which covers the **read-only ingestion**
> connector. This doc covers the **conversational bot** — DM `@holo` in
> Google Chat, @mention it in a space, and it answers from your indexed
> sources. Both can run side by side; neither replaces the other.

The Chat App is the Google Chat equivalent of the Slack `/holo` + `@holo`
bot. v1 ships the shared-app path: one Cloud project hosts the app for the
whole holo deployment, and each org claims its Google Workspace by pasting
its customer ID in the dashboard. The per-org BYO-app path is planned but
not yet exposed in the UI.

## Operator setup (one-time, per holo deployment)

### 1. Create a Cloud project + service account

1. In Google Cloud Console create a dedicated project (e.g.
   `holo-chat-app-prod`).
2. Enable the **Google Chat API**:
   <https://console.cloud.google.com/apis/library/chat.googleapis.com>
3. Create a service account in this project (any name). Grant it no roles.
   Create a JSON key and download it — this is the service account that
   mints outbound bearer tokens. **Treat the JSON as a secret.**
4. Note the **Cloud project number** (Console → Project Settings →
   "Project number"). This is the JWT audience holo will verify inbound
   requests against.

### 2. Configure the Chat App

Open the Chat API page and switch to the **Configuration** tab:

<https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat>

- **Build this Chat app as a Workspace Add-on**: uncheck.
- **Application name**: `holo`
- **Avatar URL**: 250×250 PNG, publicly hosted (any HTTPS URL).
- **Description**: `Ask holo from Google Chat` (≤ 40 chars).
- **Interactive features**: **ON**.
  - **Functionality**: check both *"Receive 1:1 messages"* and
    *"Join spaces and group conversations"*.
  - **Connection settings**: choose **HTTP endpoint URL**.
  - **Endpoint URL**:
    `https://{your-gateway-host}/google-chat-app/events`
  - **Authentication audience**: pick **Project number** (Google signs
    JWTs with `aud` = your Cloud project number, which is what holo's
    gateway verifies against `GOOGLE_CHAT_APP_PROJECT_NUMBER`). Picking
    *HTTP endpoint URL* will cause every inbound event to fail
    verification with `wrong_audience`.
- **Visibility / installation model**: this controls *who can install*
  the app — not who the JWT aud is. Pick based on your deployment shape:
  - **Single-tenant** (you're running holo just for your own
    Workspace): "Restrict to specific people and groups in your
    organization" → your domain. Only users in your Workspace can install.
  - **Multi-tenant** (hosted holo, e.g. holobase.dev — you want other
    holo orgs' Workspace admins to be able to install): publish the app
    to the **Google Workspace Marketplace**. Create a Marketplace SDK
    listing on the same Cloud project; private listing skips public
    brand review and lets you whitelist customer domains.
- **App status**: **LIVE — available to users in your domain**.

Save.

The Cloud project is the *platform owner* (it signs and receives every
event for every Workspace that installs the app), not the *tenant
boundary*. The JWT `aud` is your project number regardless of which
customer Workspace originated the event; per-org routing happens via the
`customerNumber` in the event payload (see step "Admin setup" below).

### 3. Set env vars on gateway + worker

```bash
GOOGLE_CHAT_APP_PROJECT_NUMBER=123456789012        # Cloud project number
GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON='{"type":"service_account", ...}'
```

These must be set on **both** `apps/gateway` (for outbound API calls and
inbound JWT verification) and `apps/worker` (for the BullMQ processor).
Redeploy after setting.

The gateway logs `google-chat-app events: GOOGLE_CHAT_APP_PROJECT_NUMBER unset,
rejecting` if the audience is missing — every inbound request returns 503
until configured.

### 4. Verify the gateway accepts events

From the Chat API Configuration tab in Cloud Console, click **"Test in
space"** → "Send a test message". The gateway should log a `MESSAGE` event
ack at 200. (The bot won't reply yet — that requires Step 5.)

## Admin setup (per Holo organization)

Once the deployment is configured, each org's admin completes their own
one-time claim from the holo dashboard:

1. Sign in to the holo dashboard.
2. Go to **Connect Agent → Chat bot → Google Chat**.
3. Status shows `workspace_unclaimed`.
4. Open Google Admin Console →
   <https://admin.google.com/ac/accountsettings> → **Profile → Customer ID**.
   Copy the value — it looks like `C0xxxxxxx`.
5. Paste it into the dashboard, click **Register Workspace**.

Behind the scenes, this writes a row to `google_chat_workspaces` mapping
that `customerNumber` to the org. The worker resolves every inbound event
through this table (see
[`apps/worker/src/google-chat-bot/workspace.ts:33`](../../apps/worker/src/google-chat-bot/workspace.ts)).
`customer_number` has a UNIQUE index — if another holo org already claimed
the same Workspace, the dashboard returns 409.

## Architecture

```
Google Chat ─POST(JWT)─▶ apps/gateway/src/google-chat-app/events.ts
                              │
                              │ verifyGoogleChatJwt (aud = project number)
                              │ tryClaimGoogleChatEvent (idempotency)
                              │ enqueueGoogleChatBotJob (BullMQ)
                              ▼
                       queue=google-chat-bot
                              │
                              ▼
              apps/worker/src/google-chat-bot/
                              │
                              │ resolveChatWorkspace(customerNumber) → org
                              │ post placeholder card
                              │ run AgentImpl
                              │ patch placeholder with final card
```

DB tables involved: [`googleChatAppConfigs`](../../packages/db/src/schema/connectors.ts)
(EE BYO path, unused by v1), `googleChatWorkspaces` (Workspace → org map),
`googleChatEventDedupe` (idempotency).

## Limitations in v1

- **Reactions for RFC-0008 feedback aren't wired yet.** The Slack bot
  treats 👍/👎 reactions as feedback signal; the Chat equivalent requires
  a Workspace Events subscription on the bot's spaces. Tracked separately.
- **No slash commands.** Google Chat slash commands require app config
  changes; deferred until BYO-app ships.
- **No rich Cards v2 widgets in replies.** Plain text + a "Sources"
  footer. The Slack reply Block Kit fidelity comes later.
- **Bot replies in a thread per message.** In rooms this matches Slack;
  in 1:1 DMs the threading is flatter — replies append to the DM rather
  than threading visibly.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Dashboard shows `not_configured` | `GOOGLE_CHAT_APP_PROJECT_NUMBER` or `GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON` missing on web/gateway/worker. Re-deploy with both set. |
| Dashboard shows `workspace_unclaimed` after registering | Customer ID was wrong (not `C0xxxxxxx`), or another org already claimed it (409 in the network tab). |
| Gateway logs `jwt rejected` | JWT audience mismatch — the Chat App's "Authentication audience" must equal `GOOGLE_CHAT_APP_PROJECT_NUMBER` (Cloud project number). |
| Gateway logs `missing customerNumber, ack without work` | Test pings from Cloud Console don't include a customerNumber. Real events from your Workspace will. |
| DM the bot, nothing happens | Check (a) the bot is set to LIVE in Chat API config; (b) `google_chat_workspaces` row exists for the right customerNumber; (c) worker is consuming from `google-chat-bot` queue. |
| Bot replies but with `internal error` card | Worker log has the agent-runner error — usually a downstream connector issue, not Chat App config. |

## EE / BYO-app (planned)

Each customer registers their own Chat App in their own Cloud project
pointing at `/google-chat-app/events/:orgId`. JWT audience comes from
`google_chat_app_configs.audience`, outbound creds from
`google_chat_app_configs.service_account_json`. The dashboard wizard for
pasting the JSON + project number isn't built yet — that's the next
iteration on this surface.
