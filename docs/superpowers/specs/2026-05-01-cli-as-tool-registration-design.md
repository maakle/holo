# CLI-as-tool registration — design

**Status:** approved (2026-05-01), ready for plan
**Branch:** `claude/holo-v0.3-cli-as-tool`
**Roadmap item:** v0.2 — "CLI-as-tool registration" (`docs/ROADMAP.md`)
**Predecessor:** v0.2 (PR #6, `f2d06c7`) — `execute_skill`, allowlist proxy, audit log, DCR/consent

## Goal

Let an org admin expose a scoped CLI invocation (`bq query`, `psql`, `aws s3 ls`, etc.) as an MCP tool that any agent calling holo's MCP endpoint can use, gated by the existing per-skill allowlist.

This replaces "build a per-database connector" with "register a CLI invocation with scoped credentials" — the pattern observed working in the founder's CTO MVP.

## Non-goals (this slice)

- Web UI for registration. Privileged config; CLI-only for v0.3.
- Per-user (rather than per-org) tool registration.
- Sandboxing (Docker / nsjail / firejail). Explicit non-goal — documented.
- Cross-org tool marketplace.
- Streaming output. Single response, not streamed.
- Enforced read-only. holo cannot enforce — see §6.

## Surface — what the operator types

```bash
holo tool register \
  --name bigquery_analytics_query \
  --description "Read-only BQ query against the analytics dataset" \
  --command bq \
  --arg query --arg --format=json --arg --max_rows=1000 --arg "{{sql}}" \
  --schema-file ./bq-tool.schema.json \
  --env-allow GOOGLE_APPLICATION_CREDENTIALS \
  --scope "dataset:analytics_readonly" \
  --read-only \
  --timeout-ms 30000

holo tool list
holo tool show <name>
holo tool unregister <name>
```

Runs from a host with `DATABASE_URL` access — same operational model as `holo allowlist add`. No web UI in this slice.

`--arg` is repeatable and order-preserving. Placeholders are `{{name}}`; they resolve from the input payload after schema validation. `--schema-file` is a standard JSON Schema document, stored verbatim and re-served as the MCP tool's `inputSchema`.

`--env-allow` is the env-var allowlist passed through from holo's host env to the spawned child. Anything not on the list is stripped. `--read-only` is an advisory label (see §6). `--scope` is a free-form audit label shown in the MCP description and on every audit event.

## Architecture

### Storage — `custom_tools` table

```ts
custom_tools(
  id uuid pk,
  organization_id uuid → organization.id,
  name text,                    // MCP-safe slug, unique per org
  description text,
  command text,                 // the binary, e.g. "bq"
  args_template text[],         // argv parts, e.g. ["query","--format=json","{{sql}}"]
  input_schema jsonb,           // JSON Schema; served as MCP inputSchema
  env_allowlist text[],         // env var names passed through from holo's env
  scope text,                   // free-form audit label
  read_only boolean,            // advisory; see §6
  timeout_ms int default 30000,
  max_output_bytes int default 262144,
  created_at timestamptz default now(),
  created_by uuid → user.id,
)
unique(organization_id, name)
index(organization_id)
```

Schema-presence test in `packages/db/test/*-schema.test.ts` updated **in the same commit** as the migration. (This was the v0.2 bite worth not repeating.)

### MCP wiring

`apps/mcp/src/tools/index.ts` `listTools()` becomes org-scoped:

```
listTools(ctx) := [...static built-ins, ...customToolsForOrg(ctx.organizationId)]
```

Each custom tool's `run(ctx, args)`:

1. Validate `args` against stored `input_schema` (Ajv, strict mode).
2. Expand `args_template` → argv. Literal substitution of `{{name}}` with the validated arg value, **stringified**. No shell interpretation. Literal `{{` is preserved by escaping convention `{{{{`.
3. `child_process.spawn(command, argv, { env: filtered, timeout: timeout_ms, shell: false })`.
4. Capture stdout and stderr up to `max_output_bytes` each; flag `truncated: true` if exceeded; kill the child on cap.
5. Return `{ stdout, stderr, exit_code, truncated, duration_ms }`.
6. Write an `audit_events` row regardless of outcome (§7).

Built-in tools stay statically defined in `tools/index.ts`. Only custom tools come from the DB. The DB read is per-request; no caching in this slice (low call rate; correctness over latency).

### Boundary rule

Per existing ESLint rule, `apps/mcp` may not import `packages/db` directly — it goes through `packages/retrieval-core`. The `customToolsForOrg(orgId)` query lives in a new module under `packages/retrieval-core` (or a new sibling `packages/custom-tools` if cleaner) and is consumed by `apps/mcp/src/tools/index.ts`. CLI commands consume it via the same package.

## Authorization — slot into existing allowlist

Custom tools are **never auto-allowed**. The existing `checkToolAllowed` rule ("empty `tool_allowlist` ⇒ all allowed") continues to apply to built-ins only. Custom tools require their name to be present in the active skill's `tool_allowlist`. No active skill ⇒ no custom-tool calls.

This is a deliberate departure from the built-in default. Built-ins are read-only retrieval over data the org already chose to ingest. Custom tools spawn arbitrary binaries with org credentials. Auto-allowing them would defeat the purpose of the v0.2 allowlist proxy.

Concretely, in `apps/mcp/src/middleware/allowlist.ts`:

```ts
// pseudo
isCustom = customToolNames.has(toolName)  // computed once per request
if (ALWAYS_ALLOWED.has(toolName)) return true
if (isCustom) return allowlist.includes(toolName)  // never empty-allow
if (allowlist.length === 0) return true            // existing built-in default
return allowlist.includes(toolName)
```

## Read-only — honest framing

`--read-only` is an **advisory label**. holo cannot enforce read-only at the binary boundary; SQL is opaque, CLI flags can permit writes, etc. The registrant must supply a credential that is read-only **at the source** (e.g., a GCP service account with `roles/bigquery.dataViewer` on a specific dataset and nothing else).

The label is:

- stored in `custom_tools.read_only`,
- prepended to the MCP-visible description (§5),
- recorded on every audit event,
- surfaced in any future consent UI (out of scope here).

The spec calls this out explicitly so users do not get false security from the flag.

## MCP description shape

Each custom tool's MCP-visible `description` is prefixed:

```
[CUSTOM | read-only | scope: dataset:analytics_readonly] Read-only BQ query against the analytics dataset
```

The prefix is computed at `listTools` time from `read_only` and `scope`; it is not stored. `read-only` token is omitted if `read_only=false`. `scope` token is omitted if `scope` is null.

## Audit + observability

Every invocation writes an `audit_events` row using the existing `@holo/audit` package:

```json
{
  "kind": "custom_tool_invoke",
  "organization_id": "...",
  "tool_name": "bigquery_analytics_query",
  "args": { "sql": "SELECT 1" },
  "exit_code": 0,
  "duration_ms": 412,
  "truncated": false,
  "scope": "dataset:analytics_readonly",
  "read_only": true
}
```

`args` are stored verbatim. **Registrants must keep secrets in env, not args** — documented in `holo tool register --help` and in the user-facing docs page.

Per-tool latency/exit-code distributions are derivable from `audit_events`; no new metrics surface in this slice.

## Test plan

### Test-first (parsers, gates, security)

In `packages/custom-tools/test/` (or wherever the package lands):

- **Argv expander**
  - Correct substitution of single placeholder.
  - Multiple placeholders, order-preserved.
  - Missing placeholder ⇒ clear error before spawn.
  - Literal `{{{{` survives as `{{`.
  - Shell metacharacters in arg values are passed through as literal argv (not shell-interpreted) — the security control.
- **Input validator**
  - Valid args pass.
  - Invalid args ⇒ structured error before spawn.
  - Args not declared in schema ⇒ rejected (Ajv strict mode).
- **Output capper**
  - Stdout under cap ⇒ `truncated: false`.
  - Stdout over cap ⇒ `truncated: true`, child killed.
- **Allowlist gate** (`apps/mcp/test/allowlist.test.ts`, extended)
  - Custom tool with empty allowlist ⇒ denied.
  - Custom tool listed in allowlist ⇒ allowed.
  - Built-in tool with empty allowlist ⇒ allowed (regression).
  - `ALWAYS_ALLOWED` built-ins unchanged.

### Test-alongside (wiring)

- Register → list → invoke roundtrip via MCP JSON-RPC integration test.
- Fixture binary at `apps/mcp/test/fixtures/echo-tool.sh` echoes its argv (newline-separated) and selected env vars; assertions confirm argv structure and env filtering (allowed vars present, others absent).
- Audit-log entry written on both success and non-zero exit.
- `holo tool register/list/show/unregister` CLI integration test against an in-process Postgres.
- `packages/db/test/*-schema.test.ts` includes the new table and columns.

## Operational notes

- The `command` field stores the binary as written. holo does not resolve to absolute path on registration — `PATH` lookup happens at spawn time. This means the binary must be on the holo host's `PATH`. Documented.
- `timeout_ms` and `max_output_bytes` cannot exceed hard ceilings (60s and 1 MiB respectively) enforced at registration time.
- Names must match `^[a-z][a-z0-9_]{2,63}$` and not collide with any built-in tool name.
- Unregister is a hard delete. There is no soft-delete or version history in this slice.

## Migration & rollout

- One Drizzle migration adds `custom_tools` (and the schema-presence test).
- Existing skills' `tool_allowlist` columns are unchanged. Operators wishing to call a new custom tool from a skill must update that skill's `tool_allowlist` (existing UI/CLI path).
- No data migration. Feature is inert until the first `holo tool register`.

## Open questions (deferred, not blocking)

- Web UI for registration. Defer until the auth-gating story (org admins only) is settled.
- Per-user fan-out — gated on the v0.2 per-user OAuth ACL fan-out work, which is the next slice after this one.
- `holo tool dry-run <name> --args …` for local validation without DB writes. Cheap to add later; not in v1.
- Streaming output. Requires MCP streaming support; revisit when an agent actually needs it.

## Spec self-review

- Placeholder scan: none.
- Internal consistency: §4 authorization rule and §3 wiring agree on "custom tools never auto-allowed".
- Scope: single migration, single MCP wiring change, one new package or new module, one CLI command group. Single implementation plan.
- Ambiguity: `--read-only` could be misread as enforcement; §6 is explicit that it is not.
