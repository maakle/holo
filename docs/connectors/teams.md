# Microsoft Teams ingestion

Holo's Teams ingestion connector reads channel + chat history from
resources where the **@holo bot** is installed. There are no per-user
credentials and no per-user OAuth: auth is app-only via the same Azure
AD app registration that drives the bot, scoped by **Resource-Specific
Consent (RSC)** so Microsoft Graph itself enforces the boundary —
nothing in our code can read a channel the bot isn't in.

> The bot and ingestion are independent surfaces sharing one Azure AD
> app + one set of env vars. The bot is documented separately in
> `docs/connectors/teams-bot.md`. Customers can use just the bot, just
> ingestion, or both. Disconnecting one doesn't affect the other.

---

## Operator setup

The Teams ingestion connector reuses the bot's `TEAMS_BOT_APP_ID` +
`TEAMS_BOT_APP_SECRET` env vars. If the bot is already configured per
`docs/connectors/teams-bot.md`, **the operator has no extra work** —
ingestion just needs the dashboard "Enable" button (next section).

If the bot isn't configured yet, follow the Operator setup steps in
`docs/connectors/teams-bot.md` first. Both surfaces depend on the same
Azure AD app registration + Azure Bot resource + env vars.

### Permissions required

The bot's manifest already declares the Resource-Specific Consent
permissions ingestion needs (added in PR #201):

| Permission | Used for |
|---|---|
| `ChannelMessage.Read.Group` | Read channel messages where bot is installed |
| `TeamSettings.Read.Group` | Team display name etc. for path labels |
| `TeamMember.Read.Group` | Membership rosters for per-user ACL filtering |
| `ChatMessage.Read.Chat` | Read 1:1/group/meeting chats where bot is installed |
| `ChatMember.Read.Chat` | Chat membership for per-user ACL filtering |

Each tenant that installs the bot grants all five at sideload time.
Existing tenants (installed before manifest version that added these)
need to **re-sideload the updated `holo-bot.zip`** to grant the new
perms — see `docs/connectors/teams-bot.md § Upgrading from bot-only
to bot + ingestion` for the re-consent flow.

---

## Customer enable flow (per-org)

Once the bot is installed in ≥1 Azure AD tenant for the org:

1. Open the dashboard → **Connect** → **Microsoft Teams** (under
   ingestion connectors, not the chat-bot section).
2. The wizard probes status. If it says "bot not installed", complete
   the bot install flow first (`docs/connectors/teams-bot.md
   § Customer install`), then return.
3. Click **Enable ingestion**. The first sync queues immediately;
   subsequent syncs run every 6 hours.

That's it. Channels and chats discovered from RSC-granted resources
land in your corpus on the next run.

---

## What gets indexed

- **Channels** in teams the bot is added to (standard + private).
  System-event messages ("user joined channel", "topic changed", etc.)
  are filtered out at the chunker.
- **Chats** the bot is in: 1:1, group, meeting. The bot's own DMs with
  end users are filtered (chat type `oneOnOne` excluded — never useful
  corpus content).
- **Threads.** The chunker groups each parent message + its replies
  into one chunk (or recursively split if the thread is long). Each
  emits one `source_artifacts` row keyed by the synthetic id
  `teams-thread:<resource-ids>/<root-message-id>`.
- **Edits and deletions.** Microsoft Graph's `/messages/delta` endpoint
  surfaces edits as in-place updates (re-emitted via the next sync) and
  deletions via `@odata.removed`. Deletions soft-delete the matching
  `source_artifacts` row — chunks stay in the table but
  `WHERE deleted_at IS NULL` filters them out of retrieval.

### What's not indexed

- **File attachments / OneDrive files / SharePoint pages.** Files
  shared in Teams chats live in OneDrive — out of scope here. A
  separate Microsoft 365 connector covers them (or not — not built
  yet).
- **Meeting transcripts, recordings, call captions.** Different Graph
  surface, different storage, different PII risk. Worth a separate
  connector when customers ask.
- **Reactions as feedback signal.** The bot's RFC-0008 path handles
  feedback collection from the bot's own messages; we don't ingest
  third-party reactions here.
- **Cross-tenant `shared` channels.** Different ACL story; skipped at
  the sync runner.

---

## ACL model

Each chunk carries `acl_subjects` derived from the resource it lives
in:

| Resource | Subject |
|---|---|
| Standard channel post | `team:<aadTeamId>` |
| Private channel post | `team-channel:<channelId>` |
| Chat thread | `chat:<chatId>` |

All chunks also carry `org:<organizationId>` so cross-org leakage is
impossible regardless of the per-resource subject.

Per-user retrieval filtering happens via `user_subjects_cache`. The
`runTeamsSubjectsSync` resolver (PR #207) walks the bot's
installed-resources list, checks AAD membership for each holo user,
and writes `team:<id>` / `chat:<id>` rows. Until those rows exist for
a user, retrieval falls back to `org:<id>` only — the user can see
all Teams content in the org's corpus.

> **Status today**: the resolver is built and tested, but no scheduled
> trigger invokes it yet. The trigger glue is the highest-priority
> follow-up — see "Known limitations" below. Until it lands,
> per-user Teams ACL is permissive.

### Private channels

The chunker emits `team-channel:<channelId>` for private channels (so
non-channel-members in the parent team can't retrieve via the
team-wide subject), but the user-subjects resolver doesn't yet emit
matching subjects (would require `listChannelMembers` on the Graph
client). **Net effect**: private-channel content is invisible to
retrieval today. Safer than the alternative (overly broad). Tracked
as a follow-up.

---

## How the sync flow works

```
Scheduler ─every 6h─▶ teams-sync queue
                          │
                          ▼
        apps/worker/src/queues/teams.ts
                          │
                          ▼
        createTeamsRunner({ db, embedQueue, appId, appSecret })
                          │
                          │ 1. Read teams_installations for org
                          │ 2. For each tenant: mint Graph token
                          │    (TEAMS_GRAPH_SCOPE per-tenant cache)
                          │ 3. runTenantSync from @holo/connectors:
                          │      • list teams + chats (RSC-scoped)
                          │      • per resource: delta cursor walk
                          │      • group threads (parent + replies)
                          │      • emit per thread / deletion / archived
                          │ 4. Convert each thread to ChunkInsertPayload
                          │    via teamsThreadChunker (@holo/chunker)
                          │ 5. Batch-enqueue to embed queue
                          │ 6. Soft-delete artifacts for removed roots
                          │ 7. Persist per-tenant cursor in
                          │    connector_cursors.metadata.byTenant
                          ▼
                  embed queue → embed-insert → chunks table
```

---

## Operator runbook

### "First sync ran but no chunks landed"

1. Dashboard → connector card → check status. If "ready_to_enable",
   ingestion was never enabled — click Enable.
2. Confirm `teams_installations` rows exist for the org. The ingestion
   runner returns `artifactCount: 0` when the org has no installed
   tenants.
3. Confirm the bot is added to ≥1 channel or chat in that tenant. RSC
   only grants Graph access to resources where the bot is installed;
   an empty install = nothing to read.
4. Check worker logs for `teams-runner` lines. The most informative
   error is `HOLO_FETCH_FAILED Microsoft Graph 403 …` — usually means
   the tenant admin revoked consent for one specific resource. The
   sync runner will mark that resource `archived` in the cursor and
   keep the rest going.

### "Delta link expired"

Graph delta links expire after ~30 days of non-use. The runner detects
410 Gone responses and resets the affected resource to backfill mode
on the next run. No operator action needed — it self-heals.

### Re-sideload after a manifest update

If we add a new RSC permission to the manifest later, every existing
tenant must re-sideload `holo-bot.zip` to grant it. The dashboard's
manifest download route auto-bumps the version on every download so
Teams Admin Center treats the upload as an in-place update rather
than a duplicate app.

---

## Known limitations

- **User-subjects trigger glue isn't wired yet.** `runTeamsSubjectsSync`
  is built, tested, and registered, but no scheduled job invokes it.
  Until the trigger lands, per-user Teams ACL falls back to `org:<id>`
  only — the user can see all Teams content in their org's corpus.
  Closing this gap requires a way to map holo user → AAD object id;
  candidates: Better Auth Microsoft provider's `account` row, or
  capturing `from.aadObjectId` when the user @mentions the bot.
- **Private channels are unreachable in retrieval** until
  `listChannelMembers` lands on the Graph client + the user-subjects
  resolver emits `team-channel:<id>` subjects.
- **No per-channel allowlist UI.** RSC is the only allowlist — the
  bot is only granted access to resources where it was explicitly
  installed. A finer-grained UI on top would be redundant friction
  unless customers ask for it.
- **Membership rosters re-fetched per user-subjects sync.** A future
  optimization caches them in `sources.metadata.member_aad_ids` so
  the resolver doesn't round-trip Graph for every user.

---

## Cross-references

- Bot (the conversational sibling): `docs/connectors/teams-bot.md`
- Design: `docs/designs/teams-ingestion.md`
- Parallel ingestion shape: `docs/connectors/google-chat.md`
- ACL model overview: RFC 0009 (`docs/rfcs/0009-virtual-filesystem.md`)
