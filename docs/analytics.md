# Product analytics (PostHog)

Holo uses [PostHog](https://posthog.com) for first-party product analytics
across the web app, the gateway, and the worker. This doc is the single
source of truth for the event taxonomy and the rules for adding new
events.

## TL;DR

- Region: **EU** (`https://eu.i.posthog.com`).
- Optional. If `NEXT_PUBLIC_POSTHOG_KEY` / `POSTHOG_API_KEY` are unset,
  every PostHog code path becomes a no-op and the apps boot, build, and
  run identically to a vanilla self-host. There is no fallback ingestion
  to a hosted Holo endpoint — analytics simply do not exist.
- Session replay is **disabled** everywhere.
- We never send message content, file content, query strings beyond
  fixed enums, or any indexed source data to PostHog.
- The browser POSTs to `/ingest/*` on Holo's own origin
  (`apps/web/next.config.mjs` rewrites), which proxies to PostHog. This
  survives ad blockers that target `*.posthog.com`.

## Setup (managed / opt-in self-host)

1. Create a project on [eu.posthog.com](https://eu.posthog.com).
2. Grab the project's public key (begins with `phc_…`) from
   *Project settings → Project API key*.
3. Set environment variables (see `.env.example`):

   ```
   NEXT_PUBLIC_POSTHOG_KEY=phc_...
   NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com   # optional
   POSTHOG_API_KEY=phc_...                              # same value is fine
   ```

4. Restart the web, gateway, and worker processes. Verify in PostHog
   *Live events*: a page load should produce a `$pageview`, signing in
   should produce an `$identify` plus a workspace group, and an MCP
   query should produce `mcp_tool_invoked` from the gateway.

To turn analytics off in any environment, unset the keys and restart.

## Identification model

- **Landing page** (unauthenticated): anonymous distinct_id only. No
  person profile is ever created
  (`person_profiles: 'identified_only'` is set in the browser config).
- **Authenticated dashboard**: `posthog.identify(userId, { email, name })`
  plus `posthog.group('organization', orgId, { name, slug })`. Sign-out
  calls `posthog.reset()` so identity does not bleed across users on
  shared machines.
- **Gateway / worker**: server-side captures use the same `userId` as
  `distinctId` and the same organization group, so a single funnel can
  cross the client → API boundary.

## Adding an event when you ship a feature

Treat the event as part of the feature, not an afterthought.

1. **Pick the right surface.** Fire from the side that knows the action
   actually happened. UI clicks → web client. OAuth completions, sync
   lifecycle, MCP/bot invocations → gateway or worker.
2. **Declare the event** in the relevant taxonomy module:
   - Web: `apps/web/src/lib/posthog/events.ts` — add to `WebEventMap`,
     then call `trackEvent('your_event', {...})`.
   - Gateway: capture through the `Posthog` instance threaded into the
     mount options for your handler (see `apps/gateway/src/mcp/transport.ts`
     for the pattern).
   - Worker: use `getWorkerPosthog().capture(...)` from
     `apps/worker/src/posthog.ts`.
3. **Property rules.** Allowed: identifiers (org/source/provider IDs),
   counts, durations, fixed-enum statuses, success/failure flags. **Not
   allowed:** raw user input, message bodies, file contents,
   stringified errors with embedded user data, or any field whose
   cardinality is bounded only by user behavior.
4. **Update the taxonomy table below** in the same PR. The three
   `events.ts` files carry a `// keep in sync with docs/analytics.md`
   comment for exactly this reason.

## Naming conventions

- `noun_verb_pasttense`, all lowercase, snake_case.
  Good: `connector_connected`, `sync_job_failed`. Bad:
  `ConnectorConnect`, `SyncFails`.
- Property keys also snake_case in server events
  (`tool_name`, `duration_ms`). On the web client we mirror that for
  consistency with server events going to the same project.
- Group identifier for workspaces is always `organization` (PostHog
  group type).

## Taxonomy reference

### Landing (web client)

| Event | Properties | Notes |
| --- | --- | --- |
| `$pageview` | `$current_url`, `$pathname` | Sent manually on every route change so client-side nav is captured. |
| `landing_cta_clicked` | `location`, `isAuthed` | Primary CTA on hero / final CTA. |
| `landing_install_copy` | `location` | `curl … \| bash` copy button. The closest thing to a self-host conversion. |
| `landing_github_clicked` | `location` | Outbound to the GitHub repo. |
| `landing_section_viewed` | `section` | Once per page load via IntersectionObserver. |

### Dashboard (web client, identified)

| Event | Properties | Fired from |
| --- | --- | --- |
| `workspace_created` | `orgId` | `workspaces/new/create-workspace-form.tsx` |
| `workspace_switched` | `fromOrgId`, `toOrgId` | `org-switcher.tsx` |
| `connector_wizard_opened` | `provider` | `connector-row.tsx` |
| `connector_connected` | `provider` | `connector-row.tsx` — flip from disconnected → connected while wizard is open |
| `connector_disconnected` | `provider` | `connector-manage-sheet.tsx` |
| `chat_message_sent` | `messageLength`, `hasAttachments` | `chat-panel.tsx` — never includes the message body |
| `mcp_install_copied` | `client` (`'claude'` / `'cursor'` / `'other'`) | `connect-agent-panel/` |
| `agent_invite_sent` | `role` | `settings/team/invite-form.tsx` |
| `sample_data_seeded` | — | `sample-connector-row.tsx` |

### Gateway (server)

| Event | Properties | Notes |
| --- | --- | --- |
| `mcp_session_started` | `agent_identity` | New MCP session in `mcp/transport.ts`. |
| `mcp_tool_invoked` | `tool_name`, `ok`, `latency_ms`, `error_code?`, `agent_identity` | Both success and failure paths. |
| `slack_bot_mentioned` | `team_id`, `channel`, `custom_app` | `slack/events.ts`. |
| `teams_bot_messaged` | `tenant_id`, `conversation_type`, `custom_app` | `teams-bot/messages.ts`. |
| `google_chat_app_messaged` | `space_type` | `google-chat-app/events.ts`. |

### Worker (server)

| Event | Properties | Notes |
| --- | --- | --- |
| `sync_job_started` | `provider`, `queue`, `source_id` | `queues/sync-processor-base.ts`. |
| `sync_job_succeeded` | `provider`, `queue`, `duration_ms`, `artifact_count`, `skip_reason?` | Same file. |
| `sync_job_failed` | `provider`, `queue`, `duration_ms`, `error_code`, `cancelled` | Same file. |

## What we deliberately do not capture

- Session replay (DOM playback).
- The body of chat messages, MCP tool inputs/outputs, or any indexed
  content.
- File names of uploaded user content.
- Free-text fields submitted by the user (workspace names, invite
  messages).
- IP addresses beyond the standard PostHog GeoIP enrichment, which can
  be turned off per-project in PostHog settings.

If you're not sure whether a property is safe, leave it out and discuss
in the PR.
