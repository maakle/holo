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
display_information:
  name: Holo Dev
features:
  bot_user:
    display_name: Holo
    always_online: false
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
      - groups:history
      - groups:read
      - users:read
      - team:read
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

4. Click **Create**, then **Install to Workspace** to authorize the bot.

### Local development

Slack rejects `http://` redirect URLs except for `http://localhost`. Two options:

- **Plain localhost** (simplest): use `http://localhost:3000` in the manifest. Works for the dashboard.
- **HTTPS tunnel** (matches prod): expose the dev server with `cloudflared tunnel` or `ngrok` and use the tunnel URL.

If you change the URL later, edit the redirect URLs under **OAuth & Permissions** rather than recreating the app.

## 2. Grab credentials

In the app's sidebar → **Basic Information** → **App Credentials**:

- **Client ID** → `SLACK_CONNECTOR_CLIENT_ID`
- **Client Secret** → `SLACK_CONNECTOR_CLIENT_SECRET`

Add both to `.env.local`:

```
SLACK_CONNECTOR_CLIENT_ID=...
SLACK_CONNECTOR_CLIENT_SECRET=...
```

Restart `apps/web` to pick up the env vars. The Slack card on `/integrations` will flip from "Not connected" to connectable.

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

## Allowlist enforcement

Channels selected in the picker are written to `connector_allowlists` (glob or exact-id, audit-trailed). The ingestion worker filters against this list before fetching history — see [`CONTRIBUTING.md`](../../CONTRIBUTING.md) § "Adding a connector" for the broader contract.
