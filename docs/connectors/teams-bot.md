# Microsoft Teams bot (conversational)

The Teams bot is the Microsoft equivalent of the Slack `@holo` and Google
Chat `@holo` bots. DM the bot or @mention it in any team channel or group
chat to get answers grounded in your indexed sources.

There's no read-only Teams ingestion connector — chat history isn't synced.
The bot answers from the existing corpus only.

v1 ships the **shared-bot** path: one Azure AD app registration hosts the
bot for the whole holo deployment, and each org claims its Azure AD tenant
by sideloading an app package + pasting its tenant id. A BYO-bot path (per-
org Azure registration) is reserved in the schema (`teams_app_configs`) but
not yet exposed in the UI.

AppSource (Microsoft's app marketplace) publishing is a future workstream;
v1 install is sideload-only via Teams Admin Center.

---

## Operator setup (one-time, per holo deployment)

### 1. Register an Azure AD app

1. Sign in at <https://portal.azure.com> as a tenant admin.
2. **Azure Active Directory** → **App registrations** → **New
   registration**.
3. **Name**: `holo` (or `holo-bot-prod`).
4. **Supported account types**: **Accounts in any organizational directory
   (Any Azure AD tenant — Multitenant)**. Required — the shared bot must
   accept inbound activities from every tenant that sideloads it.
5. **Redirect URI**: leave empty. The bot doesn't run an OAuth flow against
   end users at v1.
6. Click **Register**.
7. Copy the **Application (client) ID** — this is your `TEAMS_BOT_APP_ID`.

### 2. Create a client secret

1. In the app registration → **Certificates & secrets** → **New client
   secret**.
2. Set an expiration (max 24 months). Document the rotation date.
3. Copy the **Value** immediately — Azure won't show it again. This is your
   `TEAMS_BOT_APP_SECRET`.

### 3. Create an Azure Bot resource

1. From the Azure home, **Create a resource** → search for **Azure Bot** →
   **Create**.
2. **Bot handle**: `holo` (or any unique slug).
3. **Subscription / Resource group**: your existing ones.
4. **Pricing tier**: F0 (free) is fine; the bot stays well under quota.
5. **Microsoft App ID**: pick **Use existing app registration** and paste
   the App ID from step 1.
6. **Multi tenant**: yes.
7. Click **Review + create** → **Create**.
8. After deployment, open the bot resource → **Configuration** →
   **Messaging endpoint**: paste:
   ```
   https://{your-gateway-host}/teams-bot/messages
   ```
9. Under **Channels** → **Microsoft Teams**, click **Apply** and accept the
   ToS. (No Teams = no inbound traffic, even if everything else is right.)

### 4. Set env vars on gateway + worker

```bash
TEAMS_BOT_APP_ID=00000000-0000-0000-0000-000000000000
TEAMS_BOT_APP_SECRET=<value from step 2>
```

Both must be set on the gateway (verifies inbound JWTs, signs outbound
bearer tokens) and on the worker (mints tokens to PUT activity updates).

Re-start the gateway and worker.

### 5. Verify

Open the dashboard → **Connect** → **Microsoft Teams** → **Run check**.
Expected output:

```
app_id          set
app_secret      set
token_exchange  ok
```

If `token_exchange: failed`, the secret is wrong, expired, or the Azure
Bot resource hasn't been linked to this App ID. Re-check step 3.

---

## Customer install (per-tenant)

Once the operator has done steps 1–5 above, each Azure AD tenant that
wants to use the bot follows three steps from the dashboard:

1. **Download** `holo-bot.zip` from
   `/connect` → Microsoft Teams → step 1.
2. **Sideload** the zip in Teams Admin Center → **Manage apps** → **Upload
   custom app**. Approve the app for the tenant.
3. Add the bot to a team or DM, then come back to the dashboard and
   **paste the tenant ID** (Azure portal → Azure Active Directory →
   Overview → Tenant ID). This writes a `teams_installations` row that
   maps inbound activities from that tenant to this holo org.

After step 3, DMing `@holo` or @mentioning it in a channel produces a
threaded reply.

### What the zip contains

The zip is generated server-side at request time:

- `manifest.json` — Teams app manifest v1.16 referencing
  `TEAMS_BOT_APP_ID` as the `bots[0].botId`. The manifest `id` is derived
  from `sha256(appId + organizationId)` so re-downloads from the same org
  produce the same id and Teams treats it as an in-place update.
- `color.png` — 192×192 brand icon.
- `outline.png` — 32×32 silhouette icon.

To replace the placeholder icons with branded ones, edit
`apps/web/src/lib/teams-bot/manifest.ts` — the icons are inline base64
constants so there's no separate asset to commit. (If you ship branded
PNGs externally, the manifest builder can also be pointed at a path
under `apps/web/public/`.)

---

## How the bot routes traffic

```
Teams ─POST(JWT)─▶ /teams-bot/messages       (apps/gateway)
                       │ 1. verifyTeamsJwt() — OIDC-discovered JWKS,
                       │    aud=TEAMS_BOT_APP_ID, iss=api.botframework.com,
                       │    serviceurl claim == Activity.serviceUrl
                       │ 2. tenant.id → org via teams_installations
                       │ 3. dedupe on (tenant_id, activity_id)
                       │ 4. enqueue TeamsBotJob
                       ▼
                BullMQ: queue=teams-bot
                       ▼
       apps/worker/src/teams-bot/processor.ts
                       │ post placeholder Adaptive Card
                       │ run shared AgentImpl (search/bash → answer)
                       │ PUT placeholder with final card (with [N] cites)
                       │ insert into teams_answer_index for RFC-0008
                       ▼
            POST/PUT {serviceUrl}/v3/conversations/.../activities
```

---

## Operator runbook

### Upgrading from bot-only to bot + ingestion

The bot manifest now declares five Resource-Specific Consent (RSC)
permissions so a future ingestion connector can read channel and chat
messages from resources the bot is installed in. **Existing customer
tenants must re-sideload** the updated `holo-bot.zip` for Microsoft to
grant the new permissions; the bot itself keeps working unchanged in
the meantime, but ingestion won't be able to read messages until the
re-consent lands.

The re-sideload flow:

1. Customer admin opens the dashboard → **Connect** → **Microsoft
   Teams** → **Download holo-bot.zip**. The zip's manifest version
   auto-bumps so Teams treats it as an in-place update.
2. **Teams Admin Center** → **Manage apps** → search for the existing
   holo app → **Upload** new version.
3. Teams renders a consent prompt listing the new RSC permissions
   (`ChannelMessage.Read.Group`, `ChatMessage.Read.Chat`,
   `TeamSettings.Read.Group`, `TeamMember.Read.Group`,
   `ChatMember.Read.Chat`). Admin clicks **Allow**.
4. The new permissions take effect immediately for resources the bot
   is already installed in; no re-add to channels needed.

The bot keeps responding to mentions throughout. Until the admin
re-consents, attempting to enable Teams ingestion in the dashboard
will surface a "RSC consent required" banner with a link to step 1.

(This section will move into `docs/connectors/teams.md` — the
ingestion sibling doc — when the ingestion connector lands. Until
then it lives here because the manifest is what the operator
re-uploads.)

### Rotating the client secret

1. In the Azure AD app registration, create a new secret in
   **Certificates & secrets**.
2. Update `TEAMS_BOT_APP_SECRET` on gateway + worker.
3. Re-deploy. The in-process token cache (~55 min) means existing tokens
   keep working through the rollover; new tokens use the new secret.
4. Delete the old secret in Azure once the rollover window has passed.

### Revoking a customer install

Have the admin un-sideload the app from Teams Admin Center, **or** call
`DELETE /api/connectors/teams-bot/claim?tenantId=<guid>` from the
dashboard. The DELETE removes the `teams_installations` row; further
inbound activities from that tenant fail tenant→org resolution and ack
silently.

### Diagnosing "the bot isn't replying"

In order:

1. Dashboard → Microsoft Teams → **Run check**. Confirms the gateway has
   env vars and can mint tokens.
2. Check `teams_installations` has a row for the tenant the user is
   posting from. If absent, the gateway acks 200 but the worker never
   gets a job.
3. Check worker logs for `teams-bot:` lines. The handler logs
   `workspace not connected` if the tenant has no installation, and
   `agent failed` if the LLM threw.
4. Check the Azure Bot resource's **Channels → Microsoft Teams** is still
   enabled. If a tenant admin revoked consent for the multi-tenant app,
   inbound activities stop.

---

## What's not in v1

- **BYO Azure registration per org.** The schema (`teams_app_configs`) is
  reserved but the dashboard doesn't expose the configure form. To enable,
  add `apps/web/src/app/api/connectors/teams-bot/configure/route.ts`
  parallel to the Slack BYO route and surface it on this page behind an
  EE flag.
- **AppSource publication.** Customers must sideload via Admin Center
  today. Publication requires a Microsoft Partner account + the standard
  app-review process (~weeks). Worth doing once usage justifies the cost.
- **Reactions → feedback.** The reaction-arrival path is wired through to
  the worker, but writing an `answer_feedback` row requires a Teams-user
  → holo-user mapping (parallel to `slack_user_credentials`) which
  doesn't exist yet. Reactions ack silently until that ships.
- **Slash / messaging-extension commands.** Out of scope; the bot answers
  inbound text only.
- **Branded icons.** Placeholder PNGs ship in the zip — swap them in
  `apps/web/src/lib/teams-bot/manifest.ts` before customer-facing rollout.
- **Teams ingestion.** Read-only sync of Teams channel + chat history
  is a separate connector (`docs/designs/teams-ingestion.md`,
  in-progress). The manifest already declares the RSC permissions
  needed for it; the sync runner + chunker + admin UI are next.

---

## Cross-references

- Design spec: `docs/designs/teams-bot.md`
- Slack equivalent: `docs/connectors/slack.md`
- Google Chat equivalent: `docs/connectors/google-chat-app.md`
- RFC-0008 (feedback loop the reaction path will eventually populate):
  `docs/rfcs/0008-quality-feedback-loop.md`
