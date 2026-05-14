# Slack connector setup

Holo's Slack connector uses two OAuth flows against the same Slack app:

- **Workspace install** (bot token) — ingests channel/group history for a workspace. Callback: `/api/connectors/slack/callback`.
- **Personal install** (user token) — lists the channels a specific user can see, used for allowlist UX. Callback: `/api/connect/slack-personal/callback`.

Both flows share one Client ID / Client Secret pair.

## 1. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick the workspace you want to install into (for local dev, your personal workspace is fine).
3. Paste the manifest below. Replace `https://your-domain.com` with your `BETTER_AUTH_URL`.

```yaml
_metadata:
  major_version: 1
  minor_version: 0
display_information:
  name: Holo Dev
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: Holo
    always_online: false
  slash_commands:
    - command: /holo
      url: https://your-gateway-domain.com/slack/commands
      description: Ask holo for context
      usage_hint: "[--public] your question"
      should_escape: false
oauth_config:
  redirect_urls:
    - https://your-domain.com/api/connectors/slack/callback
    - https://your-domain.com/api/connect/slack-personal/callback
  scopes:
    user:
      - channels:read
      - groups:read
      - im:read
      - mpim:read
    bot:
      - channels:history
      - channels:read
      - channels:join
      - groups:history
      - groups:read
      - users:read
      - team:read
      # Bot interaction (the @holo bot — see "Bot setup" below):
      - app_mentions:read
      - chat:write
      - im:history
      - im:read
      - im:write
      - commands
settings:
  event_subscriptions:
    request_url: https://your-gateway-domain.com/slack/events
    bot_events:
      - app_mention
      - message.im
      - app_uninstalled
  interactivity:
    is_enabled: true
    request_url: https://your-gateway-domain.com/slack/interactivity
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

> **What changed vs. the previous manifest.** Only two additions, both
> safe and code-backed:
>
> - **`_metadata`** — required version block on Slack's current schema.
> - **`features.app_home.messages_tab_enabled`** — surfaces the Messages tab
>   in Slack so users can DM `@holo`. The `message.im` event path is already
>   handled in [`apps/gateway/src/slack/events.ts`](../../apps/gateway/src/slack/events.ts).
>
> **Intentionally NOT added** (despite being current Slack features) — these
> would change Slack-side behavior in ways the code does not yet support:
>
> - `assistant_view` / `assistant:write` / `assistant_thread_started` — Slack's
>   AI Assistant container surface. The bot only calls `chat.postMessage`, not
>   `assistant.threads.*`, so the container would render but never be driven.
>   Tracked as a future migration.
> - `home_tab_enabled` — no `views.publish` handler exists for
>   `app_home_opened`, so this would render an empty Home tab.
> - `oauth_config.pkce_enabled: true` — the Slack OAuth callbacks do not
>   persist a `code_verifier`. Enabling PKCE in the manifest would break the
>   install flow.

4. Click **Create**, then **Install to Workspace** to authorize the bot.

> **Bot vs. ingest scopes.** The first block of bot scopes (`channels:history` …
> `team:read`) is the read-only ingest set. The second block
> (`app_mentions:read` … `commands`) powers the @holo bot. If you previously
> installed Holo with only the ingest scopes, your existing install keeps
> working — but users will need to re-authorize once to grant the new bot
> scopes. The Connect-agent → Slack tab surfaces this prompt automatically.

### Local development

Slack rejects `http://` redirect URLs except for `http://localhost`. Two options:

- **Plain localhost** (simplest): use `http://localhost:3000` in the manifest. Works for the dashboard.
- **HTTPS tunnel** (matches prod): expose the dev server with `cloudflared tunnel` or `ngrok` and use the tunnel URL.

If you change the URL later, edit the redirect URLs under **OAuth & Permissions** rather than recreating the app.

## 2. Grab credentials

In the app's sidebar → **Basic Information** → **App Credentials**:

- **Client ID** → `SLACK_CONNECTOR_CLIENT_ID`
- **Client Secret** → `SLACK_CONNECTOR_CLIENT_SECRET`
- **Signing Secret** → `SLACK_CONNECTOR_SIGNING_SECRET` (required for the @holo bot — events and slash commands are HMAC-verified against this)

Add all three to `.env.local`:

```
SLACK_CONNECTOR_CLIENT_ID=...
SLACK_CONNECTOR_CLIENT_SECRET=...
SLACK_CONNECTOR_SIGNING_SECRET=...
```

Restart `apps/web` and `apps/gateway` to pick up the env vars. The Slack card on `/integrations` will flip from "Not connected" to connectable.

## Scope rationale

Bot scopes power ingestion (defined in [packages/connectors/src/slack/index.ts](../../packages/connectors/src/slack/index.ts)):

| Scope | Why |
|---|---|
| `channels:read`, `channels:history` | List + read public channel messages |
| `groups:read`, `groups:history` | Same for private channels Holo is invited to |
| `users:read` | Resolve author IDs to display names |
| `team:read` | Workspace metadata for the audit trail |

User scopes power the allowlist picker (defined in [apps/web/src/app/api/connect/slack-personal/start/route.ts](../../apps/web/src/app/api/connect/slack-personal/start/route.ts)):

| Scope | Why |
|---|---|
| `channels:read`, `groups:read`, `im:read`, `mpim:read` | Show the connecting user the channels they personally see, so they can pick which ones Holo should ingest |

DMs and MPIMs are **read for listing only** — the bot scopes deliberately omit `im:history` / `mpim:history`, so Holo never ingests DM contents.

## Bot setup (@holo)

The Slack bot rides on the same Slack app as ingest. Once the OAuth flow has
been re-run to grant the bot scopes (the Connect-agent → Slack tab prompts for
this), the gateway exposes two endpoints:

- `POST /slack/events` — Slack pushes `app_mention` and `message.im` events here. Verifies the `X-Slack-Signature` HMAC, dedupes by `event_id`, and enqueues a worker job on the `slack-bot` BullMQ queue.
- `POST /slack/commands` — Slack hits this for the `/holo` slash command. Same verification + enqueue path, plus an immediate ephemeral "thinking…" ack so Slack's 3-second deadline isn't blown.
- `POST /slack/interactivity` — Slack hits this when a user clicks an action button on a bot message (today: the "Show sources" button on agent answers). Same HMAC verification; reads the source list from `message.metadata` and replies ephemerally via the per-interaction `response_url`. **Required for the button to work** — without it, Slack shows _"this app is not configured to handle interactive responses"_ on click.

The worker (`apps/worker/src/slack-bot/`) resolves the workspace credentials
by `team_id`, runs a workspace-scoped search, and posts back via the bot
token (or the slash command's `response_url`).

### Pointing Slack at your gateway

For prod, set the Event Subscriptions, slash command, and Interactivity Request
URLs to your gateway's public origin — e.g.
`https://gateway.holobase.dev/slack/{events,commands,interactivity}`. For local
dev, you'll need a tunnel (`cloudflared` or `ngrok`) on top of `MCP_PORT`
(default `8080`).

### Per-workspace ACL

The bot answers using the workspace's full indexed corpus (subject
`org:<orgId>`), regardless of which user asked. We deliberately don't filter
per-user — see the "Open decisions" thread in the launch PR for context. If
you need per-user ACL, swap `userSubjects` in
[`apps/worker/src/slack-bot/handler.ts`](../../apps/worker/src/slack-bot/handler.ts)
to resolve via `slackUserCredentials` + `getSubjectsForUser`.

## Allowlist enforcement

Channels selected in the picker are written to `connector_allowlists` (glob or exact-id, audit-trailed). The ingestion worker filters against this list before fetching history — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Adding a connector" for the broader contract.
