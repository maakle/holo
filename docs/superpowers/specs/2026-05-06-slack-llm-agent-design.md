# Slack LLM agent — design

**Status:** approved (2026-05-06), ready for plan
**Roadmap item:** Slack bot UX parity with claude.ai

## Goal

Replace the Slack bot's current "top-3 retrieval blocks" output with a synthesized, conversational answer produced by Claude calling holo's MCP tools in a loop. Match the experience users get when they query holo via the MCP integration in claude.ai.

## Motivation

Today the Slack bot dumps the top 3 chunks from `search()` directly to the channel. Users compared this side-by-side with claude.ai (which calls the same holo MCP server) and the claude.ai output is dramatically better — synthesized prose that reasons across multiple tool calls (`search` → `get_doc`/`get_thread`/`get_pr`) and answers the actual question. The difference isn't the retrieval; it's that an LLM sits between the tools and the user. We want that LLM in the Slack path too.

## Non-goals (this slice)

- Streaming token-by-token updates. Single placeholder → single edit.
- Inline `[1]` numbered citations. We use a "Sources" footer instead.
- Per-org BYOK for the Anthropic API key. Single env-var key paid by holo.
- Conversation memory across turns. Each `@holo` mention is independent — no thread-history awareness in v1.
- A fallback to the old retrieval-blocks output. On failure, post a short error.
- Replacing the MCP server itself. Claude.ai → MCP path is unchanged.

## Architecture

### Where the loop lives

In the worker, as a new module `apps/worker/src/slack-bot/agent.ts`. The existing `handleSlackBotJob` in `apps/worker/src/slack-bot/handler.ts` calls `runAgent(...)` instead of `search(...)` and posts the agent's prose result.

### Tool registry — shared package

The MCP `ToolDefinition[]` registry currently lives in `apps/gateway/src/mcp/registry.ts`. It depends only on per-tool runners (which already live in `@holo/retrieval-core`, `@holo/db`, etc.) so it has no Hono/HTTP coupling. We move it to a new package:

**`packages/agent-tools/`** — exports `listTools(ctx): Promise<ToolDefinition[]>`, `ToolDefinition`, `ToolContext`. Both `apps/gateway` (for MCP) and `apps/worker` (for the Slack agent) depend on it. The gateway's `mcp/registry.ts` becomes a thin re-export.

This is the only structural refactor.

### Agent loop

```
runAgent({ db, organizationId, userSubjects, question }) → { answer: string; sources: Source[] }
```

Implementation:

1. Call `listTools({ db, organizationId, userSubjects })` to get the same `ToolDefinition[]` the MCP server exposes.
2. Convert each `ToolDefinition` to an Anthropic tool-use definition (`{ name, description, input_schema }`). The JSON schemas already match.
3. Initialize messages: `[{ role: 'user', content: question }]`.
4. Loop:
   - Call `client.messages.create({ model, system, tools, messages, max_tokens })`.
   - If `stop_reason === 'end_turn'`: extract the final assistant text, exit loop.
   - If `stop_reason === 'tool_use'`: for each `tool_use` block, dispatch to the corresponding `ToolDefinition.run(ctx, args)`, append a `tool_result` user message, continue.
   - Track every artifact returned from `get_*` tools and the top-N results from `search` calls — these become the sources footer.
5. Safety bounds: max 20 tool calls, max 60s wall clock. If exceeded, throw `AgentRunawayError` (handler renders the standard error message).

### Model

`claude-sonnet-4-6`. Multi-hop tool-use rewards reasoning. Haiku 4.5 is a future optimization.

### System prompt

```
You are holo, a knowledge assistant for {org_name}. You have tools to search
and fetch content from this organization's connected sources (Slack, GitHub,
Notion, Grain, Pylon, and others). Call tools as needed to answer the user's
question.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack
  mrkdwn), not markdown headers (#) or fenced code blocks unless quoting
  code. Bullets with `- ` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.
```

`{org_name}` is fetched from the `organizations` row at the start of the run.

### Sources collection

A `SourceCollector` accumulates entries as tools run:
- `search` results: top 3 hits per call, deduped by `snippet_url || chunk_id`.
- `get_doc`, `get_thread`, `get_pr`, `get_call`, `get_ticket`: one entry per call, using the artifact's primary URL.
- `list_skills`, `get_skill`, `execute_skill`: not surfaced as sources (they're meta-tools).
- Final dedupe by URL. Cap at 8 entries to keep the Slack message readable.

Each `Source` has `{ provider, kind, title, url }`.

### Slack rendering

Replaces `buildAnswerBlocks` in the handler:

```
[
  { type: 'section', text: { type: 'mrkdwn', text: <agent answer> } },
  { type: 'divider' },
  { type: 'context', elements: [
      { type: 'mrkdwn', text: '*Sources*' }
  ]},
  ...sources.map(s => ({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: `${s.provider} · ${s.kind} · <${s.url}|${s.title}>` }]
  }))
]
```

The placeholder ("_holo is thinking…_") flow is unchanged.

### Error handling

- Anthropic API error / network / rate limit: catch in handler, post `Something went wrong answering that — try again, or rephrase.` Log error with the job id.
- Tool runner throws: caught inside the loop, returned to Claude as a `tool_result` with `is_error: true`. Claude can recover or apologize.
- `AgentRunawayError` (safety bounds hit): same user-facing error as above; log with the partial trace.
- Missing `ANTHROPIC_API_KEY`: handler refuses to enqueue work; logs at error level. (Don't silently fall back — fail loudly.)

### Auth scope

Unchanged. The agent runs with `userSubjects: ['org:<id>']`, same as today's bot. Per-user filtering is out of scope.

## Files

**New:**
- `packages/agent-tools/` — package containing the lifted registry (`registry.ts`, `index.ts`, `package.json`, `tsconfig.json`).
- `apps/worker/src/slack-bot/agent.ts` — `runAgent`, `SourceCollector`, agent loop.
- `apps/worker/src/slack-bot/agent.test.ts` — unit tests with mocked Anthropic client + mocked tool runners.

**Modified:**
- `apps/gateway/src/mcp/registry.ts` — re-exports from `@holo/agent-tools`.
- `apps/gateway/package.json` — depends on `@holo/agent-tools`.
- `apps/worker/package.json` — depends on `@holo/agent-tools` and `@anthropic-ai/sdk`.
- `apps/worker/src/slack-bot/handler.ts` — replace `search()` call + `buildAnswerBlocks` with `runAgent()` + new block builder. Drop the result truncation logic that's no longer needed.
- `apps/worker/src/slack-bot/handler.test.ts` — update to mock `runAgent` instead of `search`.
- `packages/env/` (or wherever env vars are defined) — declare `ANTHROPIC_API_KEY` as worker-required.

**Deleted:**
- Nothing outright. `buildAnswerBlocks` and the slash-command-specific result rendering get replaced by the new builder.

## Testing

**Unit (new):** `agent.test.ts`
- Single-shot answer: Claude returns text immediately, no tool calls. Asserts answer + empty sources.
- One tool call: Claude calls `search`, returns text. Asserts dispatch, source collection, final answer.
- Multi-hop: Claude calls `search` → `get_thread` → returns text. Asserts ordering, both sources collected.
- Tool runner throws: assert `is_error: true` is forwarded to Claude, loop continues.
- Runaway safety: Claude calls tools 21 times in a row → `AgentRunawayError` thrown.
- Wall-clock safety: simulated clock past 60s → `AgentRunawayError` thrown.

**Unit (updated):** `handler.test.ts`
- App-mention happy path: agent returns answer + sources → Slack receives prose block + sources blocks.
- Agent throws: Slack receives the standard error message.
- Empty question (after stripping `<@bot>`): same behavior as today.

**No new E2E tests.** The existing Slack mocking pattern covers the handler integration.

## Cost / latency expectations

- Typical question: 2–4 tool calls, 4–10s wall clock, ~5–15k input tokens after caching, ~500 output tokens. Sonnet 4.6 pricing → roughly $0.03–$0.08 per question.
- Worst case (capped): 20 tool calls, 60s, ~$0.30. The cap exists to prevent runaway; in practice answers should converge in <8 tool calls.
- Prompt caching applies automatically to the system prompt + tool definitions, since they're identical across requests.

## Open questions

None blocking. Future work tracked outside this spec:
- Per-org BYOK for the API key.
- Thread-history awareness (Claude reads prior turns in the Slack thread).
- Streaming via `chat.update` polling.
- Per-user `userSubjects` instead of org-wide.
- Haiku 4.5 cost optimization once the loop is stable.

## Decisions log

- 2026-05-06 — Replace, not coexist. The current top-3 output is not a useful fallback; failure modes should fail loudly. (B/B/A in brainstorm.)
- 2026-05-06 — Sonnet 4.6 over Haiku 4.5. Quality of multi-hop reasoning matters more than the latency delta.
- 2026-05-06 — Sources footer (no inline `[1]` markers). Avoids prompt-engineering Claude into a citation format it's inconsistent about.
- 2026-05-06 — Agent loop runs in the worker, not the gateway. The handler is already async-job context with no HTTP timeout pressure.
- 2026-05-06 — Lift the tool registry into `@holo/agent-tools`. Avoids worker → gateway dependency.
