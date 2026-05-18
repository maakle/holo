# Google Chat: migrate from DWD to bot-in-space

## Status

Pre-implementation. Phase 0 verification gating the rest. Do not write production code for Phase 1+ until the three checks below come back green against a real Workspace.

## Why

Current connector uses service account + domain-wide delegation. Works, but:

- **Scary trust grant.** "Holo can impersonate any user in your Workspace" is a hard sell for security-conscious admins.
- **Heavy setup.** Admin Console → Security → API Controls → Domain-wide Delegation, paste client ID, paste scope list. People bounce.
- **Two separate surfaces.** Ingestion uses DWD; the conversational Chat App (`app-*.ts`) uses app-level creds. Two installs, two trust grants, two mental models.

Bot-in-space unifies both surfaces under one identity, narrows the trust grant to "Holo can read spaces it's been added to," and mirrors how Slack works (which users already understand).

The catch: admin scopes (`chat.admin.*`) alone can't read messages — there's no `chat.admin.messages.readonly` scope. But admin scopes **can** add the bot to spaces. So we use admin scopes for **setup only**, then read messages as the bot member.

## Phase 0 — verification (must run before any code)

Each check is one API call. Run all three against a test Workspace where you have admin access.

### Prerequisites

- Test Google Workspace (does not need to be production)
- Service account JSON for a Google Cloud project with Chat API enabled
- The SA configured as a Chat App in Google Cloud Console (Chat API → Configuration)
- Workspace admin account that can grant admin scopes via OAuth consent screen

### Check 0.1 — Can the bot read messages posted **before** it joined?

This is the load-bearing assumption. If false, the migration doesn't work — we'd lose historical data on every space.

**Setup:**
1. As a regular Workspace user, create a new space: "Holo Verify 0.1"
2. Post three messages: "msg 1 before bot," "msg 2 before bot," "msg 3 before bot"
3. As the same user, add Holo's Chat App to the space (`@HoloApp`)

**Test:**

```bash
# Mint app-level token (no impersonation)
ACCESS_TOKEN=$(node -e "
  const { loadChatAppAccessToken } = require('./packages/connectors/dist/google-chat/app-auth');
  const sa = require('fs').readFileSync(process.env.SA_JSON_PATH, 'utf8');
  loadChatAppAccessToken({ serviceAccountJson: sa })
    .then(r => process.stdout.write(r.accessToken));
")

# List messages in the space
SPACE_NAME="spaces/AAA..."  # from the space's URL or spaces.list
curl -s "https://chat.googleapis.com/v1/${SPACE_NAME}/messages?pageSize=20" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | jq '.messages[] | {createTime, text}'
```

**Pass criteria:** all three pre-join messages appear in the response.
**Fail criteria:** response only contains messages posted after the bot joined, or returns 403/PERMISSION_DENIED for the pre-join range.

**If this fails:** stop. The migration model breaks. Options become: (a) stay on DWD, (b) accept "history only from connection date," (c) hybrid — use admin scope for a one-time historical pull then bot for ongoing. Each requires re-planning.

### Check 0.2 — Can `chat.admin.memberships` add the bot to a space?

This determines whether the admin can bulk-install the bot via Holo's wizard, or has to add it manually to each space.

**Setup:**
1. Create a Workspace OAuth client (Google Cloud → APIs → Credentials → OAuth 2.0)
2. Authorize an admin account with these scopes:
   - `https://www.googleapis.com/auth/chat.admin.spaces.readonly`
   - `https://www.googleapis.com/auth/chat.admin.memberships`
3. Create a test space the bot is **not** in: "Holo Verify 0.2"

**Test:**

```bash
ADMIN_TOKEN="ya29...."  # admin's OAuth access token
SPACE_NAME="spaces/BBB..."
APP_NAME="users/app"    # canonical reference for "the calling Chat App"

curl -s -X POST "https://chat.googleapis.com/v1/${SPACE_NAME}/members?useAdminAccess=true" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{
    \"member\": {
      \"name\": \"${APP_NAME}\",
      \"type\": \"BOT\"
    }
  }"
```

**Pass criteria:** 200 response with a membership resource. The bot appears in the space's member list. (Verify by opening the space in Chat UI.)

**Fail criteria:**
- 403 with `Adding apps not supported via admin access` → fall back to manual per-space invites
- 400 with invalid member.name → try `users/{app-numeric-id}` or other variants from Chat API docs
- The bot doesn't actually appear despite a 200 → check `useAdminAccess` is honored

**If this fails:** the Phase 2 wizard becomes "here's the list of spaces, please add @HoloApp to each one yourself" — meaningfully worse UX but still ships. Plan still works, just less magical.

### Check 0.3 — Pub/Sub events for bot-member spaces

Determines whether Phase 3 (real-time) is bundled or deferred.

**Setup:**
1. Create a Pub/Sub topic in the SA's project: `holo-chat-events-test`
2. Grant the Chat service account `roles/pubsub.publisher` on the topic
3. Configure the Chat App in Google Cloud → Chat API → Configuration → "Connection settings" → Pub/Sub topic name
4. Use the space from Check 0.1 (bot is already a member)

**Test:**
1. Subscribe to the topic via `gcloud pubsub subscriptions pull` or a small Node listener
2. Post a new message in the test space as a user
3. Watch for an event delivery within ~5 seconds

**Pass criteria:** event arrives with `type: MESSAGE` and the message resource embedded. Includes `createTime`, `sender`, `text`, `thread.name`.

**Fail criteria:**
- No event in 30 seconds → check Pub/Sub permissions, topic configuration
- Event arrives but missing fields → check Chat API version

**If this fails:** Phase 3 deferred; Phase 1+2 still ship with polling. Not blocking.

## Recording results

| Check | Result | Date | Notes |
|---|---|---|---|
| 0.1 — pre-join history | ⏳ blocked on Google permission propagation | 2026-05-18 | See verification notes below |
| 0.2 — admin add bot | ☐ deferred (use case shifted) | | Original plan assumed `chat.admin.memberships`; bot-in-space now uses Marketplace install path instead |
| 0.3 — Pub/Sub events | ☐ not yet run | | Bundle with Phase 3 |

### Check 0.1 verification notes (2026-05-18)

What we ran (see `scripts/phase0-verify/`):
- **0.1** mints app-level token with `chat.app.*` scopes, calls `members.list` + `messages.list`
- **0.1b** scope probe across 8 candidate scope variants
- **0.1c** introspects the minted token via Google's tokeninfo endpoint
- **0.1d** fallback via DWD-impersonated user-context token

What we confirmed:
- ✅ `chat.app.messages.readonly`, `chat.app.memberships`, `chat.app.spaces` are real Google Chat
  scopes (confirmed by Google's developer docs + accepted by Google's token endpoint).
- ✅ `chat.bot` alone is **insufficient** for `messages.list` (probe 0.1b: 403
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`).
- ✅ The `chat.app.*` scopes require **Workspace Marketplace SDK setup + admin install**, NOT
  generic OAuth Consent Screen registration (which rejects them as "invalid"). This is the
  load-bearing setup-path discovery from this session.
- ✅ Token-side: introspection confirms all 4 requested scopes are present in the minted token
  (probe 0.1c).
- ⏳ API-side: `messages.list` still returns 403
  `"The administrator must grant the app the required OAuth authorization scope for this action"`
  despite the admin install having approved the scopes for the app's OAuth clients
  (`881293320323-*`). This is consistent with Google Workspace's known eventual-consistency lag
  on app-permission propagation (documented 5min–several hours).

Setup performed in our test workspace (`midlane.com`):
1. Enabled Google Workspace Marketplace SDK in GCP project `web-app-380316`.
2. Configured the SDK with Visibility=Privat, Chat-App integration, OAuth-Bereiche listing all
   3 `chat.app.*` scopes.
3. Published the private listing; installed via Admin Console → Marketplace apps for the entire
   org with explicit `chat.app.*` scope approval (visible in admin install dialog).
4. Verified the install via Admin Console → app status: `gewährt` for 3 OAuth client IDs
   (`881293320323-*`).
5. Removed + re-added the bot to the test space to rule out per-membership scope caching — same
   error.

Open questions for follow-up:
- Does Google's permission propagation eventually deliver `chat.app.*` to our SA-minted tokens,
  given the SA is in the same project as the Chat App? Re-run `pnpm phase0:check-0.1` after
  several hours / next day.
- If not, the path may be: app-auth requires the **auto-generated** Marketplace OAuth clients
  (`881293320323-*`) as the calling principal, not a separately-created project SA. Worth
  testing by minting tokens via one of those Web-application OAuth clients (requires per-user
  consent or admin-wide auto-consent on install).

What this means for Phase 1 (does not block code work):
- The verified scope URLs are correct and can be coded against. `GOOGLE_CHAT_APP_SCOPES` should
  include all 4 (`chat.bot` + the 3 `chat.app.*`).
- The architectural assertion ("bot-in-space with app-auth can read history") is documented by
  Google but not yet empirically demonstrated in our test workspace due to the propagation
  issue. The fallback (user-context tokens via DWD or per-user OAuth) provably works — same
  read-API call, different token issuance.
- Phase 2 setup flow design should anticipate **both** paths: app-auth-when-available,
  user-context-fallback-when-not.

## Phase 1 → 4 plan

(Detail below is the same plan I sketched in conversation — keeping it here for the PR description.)

### Phase 1 — Dual auth mode at the token-loader layer

**Architectural simplification from the original sketch.** The framework-bridge already centralizes Google token minting at one chokepoint (`loadGoogleServiceAccountToken` in `packages/connectors/src/google-shared/service-account.ts`), and the spec uses the framework's `HttpClient` which receives whichever token the loader returns. So the right place to branch on auth mode is the **token loader**, not the read API. Result:

- ❌ No new `app-read-api.ts` file
- ❌ No changes to `spec.ts`, `api.ts`, `chunking.ts`
- ✅ One branch in `loadGoogleServiceAccountToken` that picks DWD-impersonated vs app-level token based on the SA row's `auth_mode`
- ✅ `impersonationEmail` becomes nullable (app mode doesn't impersonate)

**Modified:**
- `packages/connectors/src/google-shared/service-account.ts` — read `auth_mode` from the SA row, mint either a delegated token (current) or an app-level token (no `sub`, `chat.bot` scope) via the existing `loadChatAppAccessToken` from `google-chat/app-auth.ts`.
- `packages/db/src/schema/connectors.ts` — add `auth_mode` column to `connectorServiceAccounts` (`'dwd' | 'app'`, default `'dwd'`); make `impersonation_email` nullable.

**Schema migration:** new Drizzle migration adds the column and relaxes the NOT NULL constraint on `impersonation_email`. Hand-authored — needs `_journal.json` entry.

**Tests:**
- Add `auth_mode: 'app'` variant to the service-account loader test that asserts the no-`sub` path is taken.
- Existing Google Chat sync tests stay unchanged — they don't care which token mode is in play, since the token is opaque from their perspective.

### Phase 2 — Setup flow (admin OAuth + space picker)

**New routes:**
- `apps/web/src/app/api/connectors/google-chat/admin-oauth/start/route.ts` — initiate OAuth with `chat.admin.spaces.readonly` + `chat.admin.memberships`.
- `apps/web/src/app/api/connectors/google-chat/admin-oauth/callback/route.ts` — exchange code, **don't persist the token** beyond the session.
- `apps/web/src/app/api/connectors/google-chat/spaces/list/route.ts` — `spaces.list?useAdminAccess=true`.
- `apps/web/src/app/api/connectors/google-chat/spaces/install/route.ts` — loop `POST {space}/members` with `member.name = users/app, useAdminAccess=true`. Background job for >20 spaces.

**New component:** `apps/web/src/components/connectors/google-chat-setup.tsx` — three-step wizard.

**Modified:** `apps/web/src/components/connect-agent-panel.tsx` — route new connections to the wizard; keep DWD reachable behind "Advanced."

**Drop:** the implicit "filter out DMs by default" in `resolveSpaces` is moot for `authMode: 'app'` since the bot can't see DMs anyway.

### Phase 3 — Pub/Sub events

**New:**
- `packages/connectors/src/google-chat/events.ts` — translate Chat events to chunker calls.
- `apps/worker/src/handlers/google-chat-events.ts` — subscriber wiring.

**Modified:** `packages/connectors/src/sync-intervals.ts` — Google Chat interval becomes a reconciliation fallback (hours, not minutes) when events are healthy.

Bundled with Phase 2 if scope allows; otherwise its own PR.

### Phase 4 — DWD deprecation

1. Ship Phase 1+2: app mode is default for new connections, DWD remains for existing.
2. Add dashboard nudge for DWD connections: "Migrate to bot-in-space" — one-click that runs Phase 2 setup on top of the existing source row.
3. After ~4 weeks, check telemetry. Mark DWD code paths deprecated if usage is near zero.
4. Remove DWD code if zero usage at Q+1.

## Open decisions

1. **Workspace Marketplace listing vs. raw OAuth consent screen** — Marketplace gives one-click install but requires Google review (~weeks). **Lean:** ship with raw OAuth, submit Marketplace listing in parallel.

2. **Bulk-add UX for >20 spaces** — rate limit ~60 QPS on `members.create`. **Lean:** background job + progress bar.

3. **DMs in `authMode: 'app'`** — unreachable. Retire the DM toggle from UI; document explicitly. Customers needing DMs stay on DWD.

4. **Bot identity** — what name + avatar the bot shows when joining a space. Set in Google Cloud → Chat API → Configuration. Pick before the first admin sees it.

## PR cadence

- **PR 1 (this doc + verification):** ship the doc, run Phase 0, record results.
- **PR 2 (medium):** Phase 1 + schema migration. App mode behind feature flag, no UI.
- **PR 3 (medium):** Phase 2 setup flow. New connections default to app mode.
- **PR 4 (small):** Phase 3 Pub/Sub. Bundle into PR 3 if scope allows.
- **PR 5 (small, later):** Phase 4 deprecation banner + telemetry.
