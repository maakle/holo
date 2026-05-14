# @holo/connectors

Provider-specific connector specs (Slack, Notion, HubSpot, Pylon, Linear,
Grain, GitHub) on top of [`@holo/connector-framework`](../connector-framework).

A connector spec is a single declarative object that tells the framework how
to authenticate, fetch, paginate, and project a third-party API into chunks
that flow through Holo's embed pipeline.

## File layout

Every connector follows the same five-file template. **Stick to this layout
when adding new connectors** — it keeps the codebase scannable and means a
new author can copy-paste a working connector and edit four files.

```
packages/connectors/src/<provider>/
├── types.ts      Provider request/response types (input shapes only)
├── api.ts        HTTP/GraphQL helpers built on framework HttpClient
├── chunking.ts   Map provider records → ctx.upsert(...) calls
├── spec.ts       createXSpec(opts) — auth, http, resources, testConnection
└── index.ts      Public re-exports (createXSpec + XSpecOptions)
```

| File | What goes in it | Example |
|------|----------------|---------|
| **`types.ts`** | TypeScript interfaces matching the API's JSON shapes. No runtime code. | `interface PylonIssue { id: string; ... }` |
| **`api.ts`** | Functions that wrap `ctx.api.get/post`. Handle pagination, multi-step fetches, GraphQL envelope unwrapping. No knowledge of chunks or DB. | `async function listIssues(api, opts) { ... }` |
| **`chunking.ts`** | The "process one record" function — fetches sub-resources via `api.ts`, builds a `<provider>RecordInput`, runs it through `@holo/chunker`, and emits chunks via `ctx.upsert(...)`. | `async function processIssue(ctx, issue) { ... }` |
| **`spec.ts`** | `createXSpec(opts)` returning a `ConnectorSpec`. The resource `sync` functions call into `api.ts` for fetching and `chunking.ts` for emitting. Contains the cursor schema. | `createPylonSpec()` |
| **`index.ts`** | Public re-exports. Always exports `createXSpec` + `XSpecOptions`. | `export { createPylonSpec } from './spec';` |

A test file lives at `packages/connectors/test/<provider>.test.ts`.

## Adding a new connector — step by step

### 0. Pick auth + http + resources

Before writing code, decide:

- **Auth strategy**: `oauth2` / `apiKey` / `githubApp` (from `@holo/connector-framework`)
- **HTTP base URL**: usually a single `baseUrl`; framework handles retry/rate-limit/auth header injection
- **Resources**: each thing the user thinks of as a separate "stream" (issues, contacts, deals, …) is one resource with its own cursor

### 1. Create the directory

```bash
mkdir -p packages/connectors/src/<provider>
mkdir -p packages/connectors/test
```

### 2. Write `types.ts`

Pure TS interfaces for the response shapes you'll touch. Project to the
fields you actually read — narrower types make the spec's intentions
obvious and break loudly if the provider changes shape.

### 3. Write `api.ts`

Functions like `listX(api, opts)` and `getXChildren(api, id)`. Use the
framework's `HttpClient` (passed in from `ctx.api`):

```ts
import type { HttpClient } from '@holo/connector-framework';

export async function listIssues(
  api: HttpClient,
  opts: { cursor?: string; updatedAfter?: string },
): Promise<IssuesPage> {
  const body: Record<string, unknown> = { limit: 100 };
  if (opts.cursor) body['cursor'] = opts.cursor;
  return api.post<IssuesPage>('/issues/search', body);
}
```

The framework injects auth headers, applies rate-limit (token bucket), and
retries with exponential backoff + Retry-After on 429/5xx. Don't reimplement
those.

### 4. Write `chunking.ts`

One exported `processX(ctx, record)` per record kind. Builds a chunker
input, runs the relevant `@holo/chunker`, and pushes every chunk:

```ts
import { pylonTicketChunker } from '@holo/chunker';
import type { ResourceSyncContext } from '@holo/connector-framework';

export async function processTicket(
  ctx: ResourceSyncContext<unknown>,
  issue: PylonIssue,
): Promise<void> {
  const sourceArtifactId = `pylon-ticket:${issue.id}`;
  const rawChunks = await pylonTicketChunker.chunk({...}, {
    organizationId: ctx.organizationId,
    sourceId: ctx.sourceId,
    sourceArtifactId,
  });
  for (const c of rawChunks) {
    await ctx.upsert({
      externalId: issue.id,
      kind: 'pylon-ticket',
      content: c.content,
      metadata: c.metadata,
      aclSubjects: c.aclSubjects,
    });
  }
}
```

**Conventions:**

- Chunk `kind` is **provider-prefixed** (`'pylon-ticket'`, `'slack-thread'`,
  `'hubspot-contact'`). The framework derives `sourceArtifactId` as
  `${kind}:${externalId}` by default.
- For records that produce chunks of *multiple* kinds (a HubSpot contact
  body + its engagement timeline), pass an explicit
  `sourceArtifactId: 'hubspot-contact:<id>'` so they share one
  `source_artifacts` row.
- **ACL invariant — every chunk MUST include `` `org:${ctx.organizationId}` `` in
  `aclSubjects`.** The Files API and RAG retrieval both filter rows by
  `acl_subjects && userSubjects`. Every user holds `org:${orgId}` as a subject,
  so this is what makes your records visible to anyone in the workspace. The
  framework auto-injects this subject and `console.warn`s once per `(provider,
  kind)` per sync if it's missing — treat that warning as a bug to fix.
  Provider-scoped subjects (e.g. `airtable:base:X`, `confluence:space:Y`,
  `slack:user:U`) are additional **grants**, not restrictions — Postgres `&&`
  is array overlap, so any matching subject makes the row visible. Add them
  alongside `org:${id}` when you have richer per-user/per-space scoping (only
  Slack populates a per-user subject cache today, via
  [packages/user-subjects](../user-subjects)).
- **URL invariant — every chunk MUST carry a deep link.** Put it in
  `metadata.url` (preferred) or `metadata.permalink` (legacy alias also
  accepted by the search layer). This is what makes citations like `[1]` in
  the Slack/Web answer surface clickable. The framework `console.warn`s
  once per `(provider, kind)` per sync when a chunk lands without either
  field — treat that warning as a bug to fix, not noise. If the provider
  has no stable per-artifact URL (rare; usually a sub-resource needs a
  parent record's URL plus a fragment), document the gap in the chunker and
  open an issue.
- **Metadata keys are `snake_case` — this is the path-fn contract.** Every
  artifact gets a virtual-filesystem path (RFC 0009) computed by a path-fn in
  [`packages/chunker/src/path-fn.ts`](../chunker/src/path-fn.ts). Path-fns
  read fields off `metadata` by key. If your chunking code emits camelCase
  (`recordId`, `spaceKey`, `fileId`) but the path-fn expects snake_case
  (`record_id`, `space_key`, `file_id`), `computePath()` silently falls back
  to externalId sentinels, `path` lands as `NULL` or a meaningless string,
  and your provider's folder never appears in the Files panel. Match the
  emitted keys to what the path-fn reads — or vice versa — for every new
  kind. Tests for the path-fn live in
  [`packages/chunker/test/path-fn.test.ts`](../chunker/test/path-fn.test.ts);
  add one for your kind that exercises the metadata shape your chunker
  actually emits.

### 5. Write `spec.ts`

Glue everything via `defineConnector(...)`:

```ts
import { z } from 'zod';
import {
  apiKey,
  defineConnector,
  type ConnectorSpec,
  type ResourceSyncContext,
} from '@holo/connector-framework';
import { listIssues } from './api';
import { processTicket } from './chunking';

const ticketsCursorSchema = z
  .object({ latestUpdatedAt: z.string().optional() })
  .default({});

type TicketsCursor = z.infer<typeof ticketsCursorSchema>;

export interface PylonSpecOptions {
  fetchImpl?: typeof fetch;
}

export function createPylonSpec(_opts: PylonSpecOptions = {}): ConnectorSpec {
  return defineConnector({
    id: 'pylon',
    displayName: 'Pylon',
    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.pylon },
    auth: apiKey({ prefix: 'Bearer ' }),
    http: { baseUrl: 'https://api.usepylon.com' },
    async testConnection(ctx) {
      const raw = await ctx.api.get<{ data: { id: string; name: string } }>('/me');
      return { externalId: raw.data.id, name: raw.data.name };
    },
    resources: [
      {
        id: 'tickets',
        cursorSchema: ticketsCursorSchema,
        async sync(ctx: ResourceSyncContext<TicketsCursor>) {
          // walk pages, processTicket each, advance cursor
          return { latestUpdatedAt };
        },
      },
    ],
    ui: { description: '…', category: 'support' },
  });
}
```

**Cursor design.** Use a Zod schema with `.default({})` so the first run
gets an empty cursor automatically. The cursor type flows through to
`ctx.cursor` typed as `z.infer<typeof yourSchema>`.

### 6. Write `index.ts`

```ts
export { createPylonSpec } from './spec';
export type { PylonSpecOptions } from './spec';
```

### 7. Wire it in

- **`packages/connectors/src/index.ts`** — add the spec to the framework-native exports block.
- **`apps/worker/src/queues/runners.module.ts`** — register
  `setSyncRunner(QUEUE_NAMES.<X>_SYNC, createGenericRunner(create<X>Spec(), deps))`.
- **`apps/worker/src/queues/types.ts`** — add `<X>_SYNC: '<x>-sync'` to `QUEUE_NAMES`
  and concurrency to `QUEUE_CONCURRENCY`.
- **`apps/worker/src/queues/<x>.ts`** — copy `linear.ts` for a 12-LOC
  Processor + Module pair.
- **`apps/worker/src/app.module.ts`** — import the new module.
- **`apps/worker/src/queues/sync-scheduler.{module,service}.ts`** — inject
  the queue and add the provider branch to `scheduleSource`.
- **`apps/web/src/lib/sync-queue.ts`** — add the provider to the `Provider`
  union and `QUEUE_NAMES_BY_PROVIDER` map.
- **`packages/db/src/schema/holo.ts`** — add the provider id to the
  `connectorCredentials.provider` `text` enum array. **No migration needed**
  — it's a Drizzle TS-enum on a plain text column.
- **`packages/chunker/src/path-fn.ts`** — register a path-fn for every chunk
  `kind` your connector emits, and add a test in
  `packages/chunker/test/path-fn.test.ts` that calls `computePath` with the
  exact metadata shape your chunker emits. Without this, your records won't
  appear in the Files panel (RFC 0009) — the worker upserts
  `source_artifacts` rows with `path = NULL` and HoloFs's `readdir` filters
  them out. See "Conventions" in §4 for the snake_case key contract.
- **`apps/worker/src/queues/framework-bridge.ts`** — if your spec uses
  `auth: none()` (public docs / help-center connectors like Mintlify and
  Zendesk), add the provider id to the no-auth short-circuit in `loadTokens`.
  Otherwise the runtime will look up `connector_credentials`, see the empty
  `accessToken: ''` row written by the connect route, treat it as falsy, and
  throw `HOLO_AUTH_NO_SESSION` on every sync.
- **OAuth provider:** add a branch to
  `apps/web/src/app/api/connectors/[provider]/initiate/route.ts` and create
  `apps/web/src/app/api/connectors/<x>/callback/route.ts` (model on Linear's).
- **API-key provider:** create
  `apps/web/src/app/api/connectors/<x>/connect/route.ts` (model on Pylon's).
- **`apps/web/src/lib/connector-registry.ts`** — add `'<x>'` to the
  `ConnectorMeta.id` union and the `CONNECTORS` list.
- **`apps/web/src/components/connector-logo.tsx`** — add the logo path.
- **`apps/web/public/connectors/<x>.webp`** — drop in the brand asset.
- **`apps/web/src/components/connection-wizard/configs.tsx`** — add a wizard
  config (the OAuth pattern is `[install, firstSync]`; api-key is
  `[apikey, firstSync]`).

### 8. Tests

A new test file at `packages/connectors/test/<x>.test.ts`. Mock fetch and
drive the spec end-to-end through the framework's `runConnectorSync` so you
exercise auth + paging + chunk emission + cursor advance in one shot.

Use `packages/connectors/test/pylon.test.ts` or `linear.test.ts` as a
template.

## Framework features you can use

The framework (`@holo/connector-framework`) gives every spec these primitives:

- **Auth strategies**: `oauth2(...)`, `apiKey(...)`, `githubApp(...)` —
  composable, swap-in. They handle authorize URL, code exchange, refresh
  (where supported), and per-request `Authorization` header injection.
- **HttpClient**: `ctx.api.get/post/request` with token-bucket rate limit,
  exponential-backoff retry that honors `Retry-After`, and standardized
  `HoloError` mapping. Configure with `http: { baseUrl, rateLimit, retry, defaultHeaders }`.
- **Paginators**: `ctx.paginate.cursor / page / linkHeader` for the common
  pagination shapes. For weird shapes (GraphQL Connections, multi-step
  associations) write a manual loop in `api.ts`.
- **Chunk upsert**: `ctx.upsert({...})` — framework computes content hash,
  dedupes against `existingHashes`, batches before enqueueing.
- **Per-resource cursors**: stored at `connector_cursors.scope =
  '<resource.id>'`. Multiple resources sync independently.
- **Allowlist**: `ctx.allowlist` — array of `{ pattern, patternKind, decision }`
  rows from the host's `connector_allowlists` table. Use
  `evaluateAllowlist()` from `@holo/connectors/shared` to filter
  candidates.
- **Cancellation**: `ctx.signal?.throwIfAborted()` between iterations.
- **Progress**: `ctx.reportProgress?.({ current, total, message })` for the
  dashboard.
- **Per-page checkpointing**: `ctx.flushCursor(partial)` so a mid-sync crash
  resumes mid-resource.

## Common pitfalls

- **Every chunk needs `metadata.url`.** The agent surface (Slack bot, web
  chat) renders citations as clickable deep links sourced from this field.
  A chunk without `metadata.url` or `metadata.permalink` is still indexed
  and searchable, but the user sees an un-linkable source row — defeating
  the point of citations. The framework warns once per `(provider, kind)`
  per sync; do not let that warning ship. For comments/replies/sub-records,
  build a URL with a fragment off the parent's URL (e.g.
  `https://...issue/HOL-42#comment-123`).
- **Don't reimplement retry / rate-limit.** The framework's `http` config
  handles it; per-call retry overrides via `opts.retry` if needed.
- **Don't depend on `@holo/db` from the spec.** All DB access goes through
  the runtime via `RuntimeStores`. The bridge in
  `apps/worker/src/queues/framework-bridge.ts` is the only Drizzle-aware
  layer below the framework.
- **`sourceArtifactId` is provider-already-prefixed.** Don't re-prefix with
  the spec id.
- **Cursor watermarks should be monotonic.** Track the highest seen
  `updatedAt` across paging and persist that — not the per-page max.
- **`auth: none()` connectors must be allow-listed in `framework-bridge.ts`.**
  The bridge's `loadTokens` falls through to `connector_credentials` for
  unknown providers, and treats an empty `accessToken` as missing. Add the
  provider to the mintlify/zendesk short-circuit when registering it.
- **Engagement / sub-resource fetch failures** should be caught and the
  parent record still indexed. Use a `try/catch` around the sub-fetch.
- **Metadata key casing must match the path-fn.** Chunkers under
  `@holo/chunker` emit snake_case (`record_id`, `channel_name`); the
  `path-fn` registry is written against that. If your connector chunks
  inline (not via `@holo/chunker`) and uses camelCase, the path-fn will
  fall through to default sentinels and your provider won't show up in the
  Files panel. Pick snake_case in `metadata` for any field a path-fn reads,
  or update the path-fn entry to accept both casings. The path-fn test
  should mirror the exact metadata shape your chunker emits — that's how
  this regression is caught at PR time instead of in prod.
