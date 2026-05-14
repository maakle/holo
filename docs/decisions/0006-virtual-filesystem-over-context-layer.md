# 0006 — Virtual filesystem over the context layer

**Status:** Accepted · **Date:** 2026-05-14

## Context

Pre-RFC-0009, agents reached into the context layer through a grab-bag of source-specific MCP tools: `get_pr`, `get_thread`, `get_doc`, `get_call`, `get_ticket`. Each took bespoke arguments (owner+repo+number, channel+ts, artifact_id, recording_id, ticket_id) and returned a bespoke shape. Adding a new source meant adding a new tool and teaching every agent prompt about it. Search ran in parallel as a separate primitive (vector + BM25 fused via RRF).

The full design and trade-offs are in [RFC 0009](../rfcs/0009-virtual-filesystem-over-context-layer.md). This ADR captures the load-bearing decision.

## Decision

Replace the per-source getter family with a **single `bash` tool** that runs against a **read-only virtual filesystem** (HoloFs) over `source_artifacts` + `chunks`. The filesystem layout is deterministic per artifact kind (see `packages/chunker/src/path-fn.ts`) — slack threads live at `/slack/#<channel>/<date>/thread-<ts>.md`, GitHub PRs at `/github/<owner>/<repo>/pulls/<n>.md`, Pylon tickets at `/pylon/tickets/<id>.md`, and so on.

`search` stays as a sibling primitive for fuzzy/semantic queries. The two are complementary: `search` for "find things matching this concept," `bash grep`/`cat` for "I know where it is, give me the bytes."

V1 command allowlist: `ls cat grep find head tail wc sort uniq tree echo`. No `eval`, no network, no `python`/`js-exec`. Read-only — writes throw `EROFS`. Per-user ACL enforced via the denormalised `source_artifacts.acl_subjects` GIN-indexed column.

The deprecated getters were left in place during the rollout with `DEPRECATED — use bash` annotations in their tool descriptions, then deleted on 2026-05-14 once `mcp_invocations` confirmed migration.

## Consequences

**Positive:**
- One tool surface for every source. Adding a new connector adds rows under `/<kind>/...` automatically — no agent-prompt update required.
- Frontier models already know how to compose `ls`, `grep -r`, `cat`. Agents pick the right operation without prompt engineering.
- ~4× faster end-to-end for path-shaped queries (one tool call, no embedding round-trip, no second LLM pass to read N chunks). Measured on the slack-bot path: 9.7s vs. the prior 38.6s search-then-read pattern.
- The same FS powers the dashboard's `/files` route — humans and agents see the exact same view, with the exact same ACL.
- Citations are stable (paths are deterministic) and shareable (a `/github/acme/api/pulls/42.md` link works in chat, slack, and the file explorer).

**Negative:**
- New code surface to defend (`just-bash` sandbox + HoloFs ACL enforcement). Defence-in-depth covered by:
  - Path parser rejects `..`, control characters, and non-absolute paths before any SQL.
  - All SQL is drizzle-templated and parameterised.
  - Per-user `acl_subjects` GIN filter on every read.
  - readFile re-checks ACL at the chunk level (a chunk with a narrower ACL than its parent artifact is never surfaced).
- `bash`-derived answers don't auto-emit citations the way `search` does — the answer prose contains paths the model wrote, but there's no `[N]` citation card linking back to the file explorer. Tracked as a follow-up.
- Default `defenseInDepth: true` in `just-bash` patches `setImmediate` during script execution, which broke postgres-js writes. Disabled in our wrapper — the V1 command allowlist + read-only FS are the load-bearing security boundary, not in-process global patching.

## Status of related changes

- Migration `0048_source_artifacts_path_and_acl` added the `path` + `acl_subjects` columns.
- Migration `0049_source_artifacts_path_not_null` locked `path` to `NOT NULL` once every kind had a registered path-fn.
- `embed-insert` now wraps the artifact upsert + chunks insert in one transaction to prevent half-written ghost rows (a real incident on 2026-05-10 left 2,014 unrecoverable Google Chat / Google Drive artifacts).
- The deprecated `get_*` tools and their `_artifact-lookup` helper were removed from `packages/agent-tools/src/tools/` on 2026-05-14.

## References

- [RFC 0009](../rfcs/0009-virtual-filesystem-over-context-layer.md) — full design
- [ADR 0002](./0002-postgres-only-hybrid-search.md) — storage shape this builds on
- [ADR 0004](./0004-multi-agent-shared-context-wedge.md) — positioning that motivates the unified surface
