# Slack LLM Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Slack bot's top-3-retrieval-blocks output with a Claude-Sonnet-driven tool-use agent that calls the same MCP tools the gateway exposes and posts a synthesized answer with a sources footer.

**Architecture:** Lift the gateway's MCP `ToolDefinition[]` registry into a shared package `@holo/agent-tools`. Add a `runAgent()` module to the worker that initializes Anthropic, converts each `ToolDefinition` to an Anthropic tool spec, runs a tool-use loop, and returns `{ answer, sources }`. The existing Slack handler calls `runAgent` instead of `search` and renders the result with a new block builder.

**Tech Stack:** TypeScript, Vitest, `@anthropic-ai/sdk` 0.92.x, NestJS/BullMQ worker, Hono gateway, Drizzle, Slack Web API.

**Spec:** `docs/superpowers/specs/2026-05-06-slack-llm-agent-design.md`

---

## File Structure

**New files:**
- `packages/agent-tools/package.json`
- `packages/agent-tools/tsconfig.json`
- `packages/agent-tools/src/index.ts`
- `packages/agent-tools/src/registry.ts` — moved from `apps/gateway/src/mcp/registry.ts`
- `apps/worker/src/slack-bot/agent.ts` — `runAgent`, `SourceCollector`, type defs
- `apps/worker/src/slack-bot/blocks.ts` — `buildAgentAnswerBlocks`, `buildErrorBlocks`
- `apps/worker/test/slack-bot-agent.test.ts` — agent loop unit tests
- `apps/worker/test/slack-bot-blocks.test.ts` — block-rendering unit tests

**Modified files:**
- `apps/gateway/src/mcp/registry.ts` — re-export from `@holo/agent-tools`
- `apps/gateway/package.json` — add `@holo/agent-tools` workspace dep
- `apps/worker/package.json` — add `@holo/agent-tools` and `@anthropic-ai/sdk`
- `apps/worker/src/main.ts` — fail-fast if `ANTHROPIC_API_KEY` missing
- `apps/worker/src/slack-bot/handler.ts` — replace `search()` + `buildAnswerBlocks` with `runAgent()` + `buildAgentAnswerBlocks`
- `apps/worker/test/slack-bot-handler.test.ts` — swap `searchImpl` for `agentImpl` and update assertions
- `pnpm-workspace.yaml` — already globs `packages/*`; verify

**Deleted (inline, not separate task):**
- `buildAnswerBlocks` and the slash-command-specific renderer in `apps/worker/src/slack-bot/handler.ts` — replaced by `blocks.ts`.

---

## Task 1: Create `@holo/agent-tools` package by lifting the gateway registry

The MCP `ToolDefinition[]` registry currently lives in `apps/gateway/src/mcp/registry.ts`. Both gateway (MCP server) and worker (Slack agent) need it; worker cannot import gateway. Lift into a new workspace package.

**Files:**
- Create: `packages/agent-tools/package.json`
- Create: `packages/agent-tools/tsconfig.json`
- Create: `packages/agent-tools/src/index.ts`
- Create: `packages/agent-tools/src/registry.ts`
- Modify: `apps/gateway/src/mcp/registry.ts`
- Modify: `apps/gateway/package.json`

- [ ] **Step 1: Create `packages/agent-tools/package.json`**

```json
{
  "name": "@holo/agent-tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@holo/custom-tools": "workspace:*",
    "@holo/db": "workspace:*",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "5.6.3"
  }
}
```

Match the exact `zod` version range from `apps/gateway/package.json` if it differs. Run `grep -h '"zod"' apps/gateway/package.json packages/retrieval-core/package.json` and copy the literal string.

- [ ] **Step 2: Create `packages/agent-tools/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 3: Move registry contents into `packages/agent-tools/src/registry.ts`**

The file is the verbatim contents of `apps/gateway/src/mcp/registry.ts`, but with each tool runner imported from `@holo/retrieval-core`-side modules instead of gateway-local paths. Since the existing tool runners (e.g. `runSearchTool`) currently live under `apps/gateway/src/tools/`, move those source files too:

- Move `apps/gateway/src/tools/{search,get-pr,get-thread,get-doc,get-call,get-ticket,list-skills,get-skill,execute-skill}.ts` → `packages/agent-tools/src/tools/`
- Update `packages/agent-tools/src/registry.ts` imports from `'./tools/search.js'` etc.
- Update each tool file's relative imports to its dependencies (most reference `@holo/retrieval-core`, `@holo/db`, `@holo/skills`, `@holo/connectors` — workspace-scoped, so no path change needed).

Add `@holo/retrieval-core`, `@holo/skills`, `@holo/connectors`, and any other workspace deps the moved tools use to `packages/agent-tools/package.json` dependencies.

- [ ] **Step 4: Create `packages/agent-tools/src/index.ts`**

```typescript
export {
  listTools,
  type ToolContext,
  type ToolDefinition,
} from './registry.js';
```

- [ ] **Step 5: Replace `apps/gateway/src/mcp/registry.ts` with re-export**

```typescript
export {
  listTools,
  type ToolContext,
  type ToolDefinition,
} from '@holo/agent-tools';
```

Delete `apps/gateway/src/tools/index.ts` (the only export from it was `listTools` from the registry). Update any `apps/gateway` import that referenced `'../tools/index.js'` or `'../tools/search.js'` etc. to import from `@holo/agent-tools` instead.

Run `grep -rn "from '../tools/" apps/gateway/src/` to find every callsite, then `grep -rn "from './tools/" apps/gateway/src/` for relative imports inside that subtree.

- [ ] **Step 6: Add the workspace dep to gateway**

In `apps/gateway/package.json` dependencies, add:

```json
"@holo/agent-tools": "workspace:*",
```

- [ ] **Step 7: Install + typecheck**

Run from repo root:

```bash
pnpm install
pnpm --filter @holo/agent-tools typecheck
pnpm --filter @holo/gateway typecheck
```

Expected: both pass with no errors. If gateway typecheck flags missing imports, fix them — every previous import of `'../tools/...'` should now resolve via `@holo/agent-tools`.

- [ ] **Step 8: Run gateway tests**

```bash
pnpm --filter @holo/gateway test
```

Expected: all existing tests pass. The lift is structural; behavior is unchanged.

- [ ] **Step 9: Commit**

```bash
git add packages/agent-tools apps/gateway pnpm-lock.yaml
git commit -m "refactor(agent-tools): lift MCP tool registry into shared package"
```

---

## Task 2: Add agent dependencies to worker

**Files:**
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Add deps to `apps/worker/package.json`**

In `dependencies`, add (alphabetized):

```json
"@anthropic-ai/sdk": "^0.92.0",
"@holo/agent-tools": "workspace:*",
```

Use the exact `@anthropic-ai/sdk` version range from `packages/skills/package.json` so the workspace pins one version.

- [ ] **Step 2: Install + verify**

```bash
pnpm install
pnpm --filter @holo/worker typecheck
```

Expected: typecheck passes. No source changes yet — just dependency wiring.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/package.json pnpm-lock.yaml
git commit -m "chore(worker): add @holo/agent-tools and @anthropic-ai/sdk"
```

---

## Task 3: Define agent module types and write the failing single-shot test

The agent module is built TDD over Tasks 3–8. Each task adds one behavior and one test.

**Files:**
- Create: `apps/worker/src/slack-bot/agent.ts`
- Create: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Create the type stub in `apps/worker/src/slack-bot/agent.ts`**

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import type { DB } from '@holo/db';
import type { ToolDefinition } from '@holo/agent-tools';

export interface Source {
  provider: string;
  kind: string;
  title: string;
  url: string;
}

export interface AgentResult {
  answer: string;
  sources: Source[];
}

export interface RunAgentDeps {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  question: string;
  /** Injected for tests. In production, instantiate per call from env. */
  client: Anthropic;
  /** Injected for tests. In production, call listTools() from @holo/agent-tools. */
  tools: ToolDefinition[];
  /** Org display name for the system prompt. */
  orgName: string;
  /** Defaults to 20. */
  maxToolCalls?: number;
  /** Defaults to 60_000 ms. */
  wallClockMs?: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

export class AgentRunawayError extends Error {
  constructor(public reason: 'tool_call_cap' | 'wall_clock_cap', message: string) {
    super(message);
    this.name = 'AgentRunawayError';
  }
}

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write the failing single-shot test**

Create `apps/worker/test/slack-bot-agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runAgent, AgentRunawayError } from '../src/slack-bot/agent';
import type { ToolDefinition } from '@holo/agent-tools';

// Minimal Anthropic client stub. Each test queues a sequence of responses
// for client.messages.create; the agent loop pops one per iteration.
function makeFakeAnthropic(responses: Array<{
  stop_reason: 'end_turn' | 'tool_use';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  >;
}>) {
  const queue = [...responses];
  const create = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error('no more responses queued');
    return next;
  });
  return {
    client: { messages: { create } } as unknown as Parameters<typeof runAgent>[0]['client'],
    create,
  };
}

const fakeDb = {} as Parameters<typeof runAgent>[0]['db'];

describe('runAgent', () => {
  it('returns the assistant text on a single-shot answer with no tool calls', async () => {
    const { client, create } = makeFakeAnthropic([
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'The deploy uses Vercel.' }],
      },
    ]);

    const result = await runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'how do we deploy?',
      client,
      tools: [],
      orgName: 'Acme',
    });

    expect(result.answer).toBe('The deploy uses Vercel.');
    expect(result.sources).toEqual([]);
    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0] as { system: string; messages: unknown[] };
    expect(callArgs.system).toContain('Acme');
    expect(callArgs.messages).toEqual([
      { role: 'user', content: 'how do we deploy?' },
    ]);
  });
});
```

- [ ] **Step 3: Run the test — it must fail**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: FAIL with `Error: not implemented`.

- [ ] **Step 4: Implement the minimal single-shot loop**

Replace the body of `runAgent` in `apps/worker/src/slack-bot/agent.ts`:

```typescript
const SYSTEM_PROMPT_TEMPLATE = `You are holo, a knowledge assistant for {org_name}. You have tools to search and fetch content from this organization's connected sources and to call any custom tools the organization has registered. Call whichever tools you need to answer the user's question — do not assume which sources are available; let the tool list and tool results tell you.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack mrkdwn), not markdown headers (#) or fenced code blocks unless quoting code. Bullets with \`- \` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.`;

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  const system = SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName);
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: deps.question },
  ];

  const response = await deps.client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system,
    messages: messages as never,
    tools: [] as never,
  });

  const text = (response.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { type: string; text?: string }) => b.text ?? '')
    .join('\n')
    .trim();

  return { answer: text, sources: [] };
}
```

- [ ] **Step 5: Run the test — it must pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): runAgent skeleton with single-shot answer path"
```

---

## Task 4: Tool dispatch — single tool call

**Files:**
- Modify: `apps/worker/src/slack-bot/agent.ts`
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Append the failing test**

Add to `apps/worker/test/slack-bot-agent.test.ts`:

```typescript
it('dispatches a tool_use, appends tool_result, and returns final text', async () => {
  const { client, create } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'deploy', top_k: 10 } },
      ],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Deploys go through Vercel.' }],
    },
  ]);

  const searchRun = vi.fn(async () => ({
    results: [
      {
        chunk_id: 'c1',
        content: 'Vercel deploys on push to main.',
        score: 0.9,
        source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
        snippet_url: 'https://github.com/acme/web/blob/HEAD/DEPLOY.md',
      },
    ],
  }));
  const tools: ToolDefinition[] = [
    {
      name: 'search',
      description: 'Hybrid search.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      run: searchRun,
    },
  ];

  const result = await runAgent({
    db: fakeDb,
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: 'how do we deploy?',
    client,
    tools,
    orgName: 'Acme',
  });

  expect(result.answer).toBe('Deploys go through Vercel.');
  expect(searchRun).toHaveBeenCalledTimes(1);
  expect(searchRun.mock.calls[0][1]).toEqual({ q: 'deploy', top_k: 10 });

  // Second call to Anthropic should include the tool_result.
  expect(create).toHaveBeenCalledTimes(2);
  const secondCall = create.mock.calls[1][0] as {
    messages: Array<{ role: string; content: unknown }>;
  };
  const lastMsg = secondCall.messages[secondCall.messages.length - 1];
  expect(lastMsg.role).toBe('user');
  expect(Array.isArray(lastMsg.content)).toBe(true);
  const toolResult = (lastMsg.content as Array<{ type: string; tool_use_id: string }>)[0];
  expect(toolResult.type).toBe('tool_result');
  expect(toolResult.tool_use_id).toBe('toolu_1');

  // Tools should be passed in Anthropic format.
  const firstCall = create.mock.calls[0][0] as { tools: Array<{ name: string; input_schema: unknown }> };
  expect(firstCall.tools).toHaveLength(1);
  expect(firstCall.tools[0].name).toBe('search');
  expect(firstCall.tools[0].input_schema).toEqual({
    type: 'object',
    properties: { q: { type: 'string' } },
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: the new test FAILs (calls `create` once instead of twice; `searchRun` not invoked).

- [ ] **Step 3: Implement the loop with tool dispatch**

Replace the body of `runAgent` in `apps/worker/src/slack-bot/agent.ts`:

```typescript
type AnthropicTool = { name: string; description: string; input_schema: Record<string, unknown> };
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
type Message = { role: 'user' | 'assistant'; content: unknown };

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  const system = SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName);
  const anthropicTools: AnthropicTool[] = deps.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
  const toolByName = new Map(deps.tools.map((t) => [t.name, t]));

  const ctx = {
    db: deps.db,
    organizationId: deps.organizationId,
    userSubjects: deps.userSubjects,
  };

  const messages: Message[] = [{ role: 'user', content: deps.question }];

  while (true) {
    const response = (await deps.client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages: messages as never,
      tools: anthropicTools as never,
    })) as { stop_reason: string; content: ContentBlock[] };

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer: text, sources: [] };
    }

    if (response.stop_reason !== 'tool_use') {
      // max_tokens or refusal — return whatever text we have.
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { answer: text, sources: [] };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      const tool = toolByName.get(use.name);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool ${use.name} not registered`,
          is_error: true,
        });
        continue;
      }
      const output = await tool.run(ctx, use.input);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(output),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
```

- [ ] **Step 4: Run — both tests must pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): runAgent dispatches tool_use blocks and forwards tool_result"
```

---

## Task 5: Multi-hop tool calls

**Files:**
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

The implementation from Task 4 already supports multi-hop (the `while (true)` loop continues until `end_turn`). This task adds a regression test.

- [ ] **Step 1: Append the test**

Add to `apps/worker/test/slack-bot-agent.test.ts`:

```typescript
it('supports multi-hop: search → get_thread → final answer', async () => {
  const { client, create } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'search', input: { q: 'incident' } },
      ],
    },
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't2', name: 'get_thread', input: { channel: 'C1', ts: '1.1' } },
      ],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'The incident was caused by a stale cache.' }],
    },
  ]);

  const searchRun = vi.fn(async () => ({ results: [] }));
  const threadRun = vi.fn(async () => ({ messages: [{ user: 'U1', text: 'cache fix' }] }));

  const tools: ToolDefinition[] = [
    { name: 'search', description: '', inputSchema: {}, run: searchRun },
    { name: 'get_thread', description: '', inputSchema: {}, run: threadRun },
  ];

  const result = await runAgent({
    db: fakeDb,
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: 'what happened in the incident?',
    client,
    tools,
    orgName: 'Acme',
  });

  expect(result.answer).toBe('The incident was caused by a stale cache.');
  expect(searchRun).toHaveBeenCalledTimes(1);
  expect(threadRun).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(3);
});
```

- [ ] **Step 2: Run — must pass without code changes**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/test/slack-bot-agent.test.ts
git commit -m "test(worker): multi-hop agent regression test"
```

---

## Task 6: Tool errors are forwarded to Claude as `is_error: true`

**Files:**
- Modify: `apps/worker/src/slack-bot/agent.ts`
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Append the failing test**

```typescript
it('forwards tool runner exceptions as tool_result with is_error: true', async () => {
  const { client, create } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'search', input: { q: 'x' } }],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I could not search.' }],
    },
  ]);

  const tools: ToolDefinition[] = [
    {
      name: 'search',
      description: '',
      inputSchema: {},
      run: async () => {
        throw new Error('database connection lost');
      },
    },
  ];

  const result = await runAgent({
    db: fakeDb,
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: 'x?',
    client,
    tools,
    orgName: 'Acme',
  });

  expect(result.answer).toBe('I could not search.');
  const secondCallMessages = (create.mock.calls[1][0] as {
    messages: Array<{ role: string; content: unknown }>;
  }).messages;
  const toolResult = (
    secondCallMessages[secondCallMessages.length - 1].content as Array<{
      type: string;
      is_error?: boolean;
      content: string;
    }>
  )[0];
  expect(toolResult.is_error).toBe(true);
  expect(toolResult.content).toContain('database connection lost');
});
```

- [ ] **Step 2: Run — must fail (exception propagates out of `runAgent`)**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: FAIL with `Error: database connection lost`.

- [ ] **Step 3: Wrap `tool.run` in try/catch**

In `apps/worker/src/slack-bot/agent.ts`, replace the inner tool dispatch block:

```typescript
    for (const use of toolUses) {
      const tool = toolByName.get(use.name);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool ${use.name} not registered`,
          is_error: true,
        });
        continue;
      }
      try {
        const output = await tool.run(ctx, use.input);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool error: ${message}`,
          is_error: true,
        });
      }
    }
```

- [ ] **Step 4: Run — must pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): forward tool runner exceptions to Claude as is_error"
```

---

## Task 7: Runaway safety — tool call cap

**Files:**
- Modify: `apps/worker/src/slack-bot/agent.ts`
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Append the failing test**

```typescript
it('throws AgentRunawayError when tool call count exceeds maxToolCalls', async () => {
  // Queue many tool_use responses; the agent should bail before all are consumed.
  const responses = Array.from({ length: 25 }, (_, i) => ({
    stop_reason: 'tool_use' as const,
    content: [
      { type: 'tool_use' as const, id: `t${i}`, name: 'search', input: { q: 'x' } },
    ],
  }));
  const { client } = makeFakeAnthropic(responses);

  const tools: ToolDefinition[] = [
    { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
  ];

  await expect(
    runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'x?',
      client,
      tools,
      orgName: 'Acme',
      maxToolCalls: 3,
    }),
  ).rejects.toMatchObject({ name: 'AgentRunawayError', reason: 'tool_call_cap' });
});
```

- [ ] **Step 2: Run — must fail (no cap yet)**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: FAIL — test consumes all queued responses and throws `no more responses queued`.

- [ ] **Step 3: Add the cap**

In `apps/worker/src/slack-bot/agent.ts`, add a counter inside `runAgent`:

```typescript
  const maxToolCalls = deps.maxToolCalls ?? 20;
  let toolCallCount = 0;
```

Then, inside the `for (const use of toolUses)` loop, increment and check **before** the dispatch:

```typescript
    for (const use of toolUses) {
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        throw new AgentRunawayError(
          'tool_call_cap',
          `agent exceeded max tool calls (${maxToolCalls})`,
        );
      }
      // ... existing dispatch ...
    }
```

- [ ] **Step 4: Run — must pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): runaway tool-call cap (default 20)"
```

---

## Task 8: Runaway safety — wall clock cap

**Files:**
- Modify: `apps/worker/src/slack-bot/agent.ts`
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Append the failing test**

```typescript
it('throws AgentRunawayError when wall clock budget exceeded', async () => {
  const { client } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
    },
  ]);

  // Synthetic clock: jumps 200_000ms forward on second read.
  const ticks = [0, 200_000];
  const now = vi.fn(() => ticks.shift() ?? 200_000);

  const tools: ToolDefinition[] = [
    { name: 'search', description: '', inputSchema: {}, run: async () => ({ results: [] }) },
  ];

  await expect(
    runAgent({
      db: fakeDb,
      organizationId: 'org-1',
      userSubjects: ['org:org-1'],
      question: 'x?',
      client,
      tools,
      orgName: 'Acme',
      wallClockMs: 60_000,
      now,
    }),
  ).rejects.toMatchObject({ name: 'AgentRunawayError', reason: 'wall_clock_cap' });
});
```

- [ ] **Step 2: Run — must fail (no clock check yet)**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: FAIL — test reaches `end_turn` and resolves to `{ answer: 'done', sources: [] }`.

- [ ] **Step 3: Add the wall clock check**

In `apps/worker/src/slack-bot/agent.ts`, near the top of `runAgent`:

```typescript
  const wallClockMs = deps.wallClockMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const startedAt = now();
```

At the top of the `while (true)` loop body (before each `client.messages.create` call):

```typescript
    if (now() - startedAt > wallClockMs) {
      throw new AgentRunawayError(
        'wall_clock_cap',
        `agent exceeded wall clock budget (${wallClockMs}ms)`,
      );
    }
```

- [ ] **Step 4: Run — must pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): wall-clock runaway cap (default 60s)"
```

---

## Task 9: Source collection

Sources accumulate across `search` and `get_*` tool calls. Each `Source` has `{ provider, kind, title, url }`. Dedupe by URL, cap at 8.

**Files:**
- Modify: `apps/worker/src/slack-bot/agent.ts`
- Modify: `apps/worker/test/slack-bot-agent.test.ts`

- [ ] **Step 1: Append the failing test**

```typescript
it('collects sources from search top-3 results and get_* artifact urls', async () => {
  const { client } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't1', name: 'search', input: { q: 'deploy' } },
      ],
    },
    {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 't2', name: 'get_doc', input: { artifact_id: 'a1' } },
      ],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Deploys go via Vercel.' }],
    },
  ]);

  const tools: ToolDefinition[] = [
    {
      name: 'search',
      description: '',
      inputSchema: {},
      run: async () => ({
        results: [
          {
            chunk_id: 'c1',
            content: 'one',
            score: 0.9,
            source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
            snippet_url: 'https://github.com/acme/web/blob/HEAD/A.md',
          },
          {
            chunk_id: 'c2',
            content: 'two',
            score: 0.8,
            source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
            snippet_url: 'https://github.com/acme/web/blob/HEAD/B.md',
          },
          {
            chunk_id: 'c3',
            content: 'three',
            score: 0.7,
            source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
            snippet_url: 'https://github.com/acme/web/blob/HEAD/C.md',
          },
          {
            chunk_id: 'c4',
            content: 'four',
            score: 0.6,
            source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
            snippet_url: 'https://github.com/acme/web/blob/HEAD/D.md',
          },
        ],
      }),
    },
    {
      name: 'get_doc',
      description: '',
      inputSchema: {},
      run: async () => ({
        provider: 'notion',
        kind: 'doc',
        title: 'Deploy Runbook',
        url: 'https://www.notion.so/abc',
      }),
    },
  ];

  const result = await runAgent({
    db: fakeDb,
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: 'how do we deploy?',
    client,
    tools,
    orgName: 'Acme',
  });

  expect(result.answer).toBe('Deploys go via Vercel.');
  // Top 3 from search + 1 from get_doc, in encounter order.
  expect(result.sources).toEqual([
    {
      provider: 'github',
      kind: 'doc',
      title: 'github · doc',
      url: 'https://github.com/acme/web/blob/HEAD/A.md',
    },
    {
      provider: 'github',
      kind: 'doc',
      title: 'github · doc',
      url: 'https://github.com/acme/web/blob/HEAD/B.md',
    },
    {
      provider: 'github',
      kind: 'doc',
      title: 'github · doc',
      url: 'https://github.com/acme/web/blob/HEAD/C.md',
    },
    {
      provider: 'notion',
      kind: 'doc',
      title: 'Deploy Runbook',
      url: 'https://www.notion.so/abc',
    },
  ]);
});

it('dedupes sources by url and caps at 8', async () => {
  const dupUrl = 'https://example.com/x';
  const { client } = makeFakeAnthropic([
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'search', input: {} }],
    },
    {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't2', name: 'search', input: {} }],
    },
    {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    },
  ]);

  const makeResults = (urls: string[]) => ({
    results: urls.map((u, i) => ({
      chunk_id: `c${u}-${i}`,
      content: '',
      score: 0.5,
      source: { provider: 'github', artifact_kind: 'doc', metadata: {} },
      snippet_url: u,
    })),
  });

  let call = 0;
  const tools: ToolDefinition[] = [
    {
      name: 'search',
      description: '',
      inputSchema: {},
      run: async () => {
        call += 1;
        if (call === 1) return makeResults([dupUrl, 'https://a', 'https://b']);
        return makeResults([dupUrl, 'https://c', 'https://d', 'https://e', 'https://f', 'https://g', 'https://h', 'https://i']);
      },
    },
  ];

  const result = await runAgent({
    db: fakeDb,
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: '?',
    client,
    tools,
    orgName: 'Acme',
  });

  // 3 from call 1 (incl. dupUrl), then dedupe + fill from call 2 top 3, capped at 8.
  expect(result.sources.length).toBeLessThanOrEqual(8);
  const urls = result.sources.map((s) => s.url);
  expect(new Set(urls).size).toBe(urls.length);
  expect(urls[0]).toBe(dupUrl);
});
```

- [ ] **Step 2: Run — must fail**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: FAIL — `result.sources` is `[]`.

- [ ] **Step 3: Implement source collection**

In `apps/worker/src/slack-bot/agent.ts`, add a `SourceCollector` and integrate it.

Above `runAgent`:

```typescript
const META_TOOLS = new Set(['list_skills', 'get_skill', 'execute_skill']);

class SourceCollector {
  private readonly seen = new Set<string>();
  private readonly entries: Source[] = [];
  private readonly cap = 8;

  add(source: Source): void {
    if (this.entries.length >= this.cap) return;
    if (this.seen.has(source.url)) return;
    this.seen.add(source.url);
    this.entries.push(source);
  }

  ingestSearchResult(output: unknown): void {
    if (!output || typeof output !== 'object') return;
    const results = (output as { results?: unknown }).results;
    if (!Array.isArray(results)) return;
    for (const r of results.slice(0, 3)) {
      if (!r || typeof r !== 'object') continue;
      const url = (r as { snippet_url?: unknown }).snippet_url;
      const src = (r as { source?: { provider?: unknown; artifact_kind?: unknown } }).source;
      if (typeof url !== 'string' || !url) continue;
      const provider = typeof src?.provider === 'string' ? src.provider : 'unknown';
      const kind = typeof src?.artifact_kind === 'string' ? src.artifact_kind : 'unknown';
      this.add({ provider, kind, title: `${provider} · ${kind}`, url });
    }
  }

  ingestArtifact(toolName: string, output: unknown): void {
    if (!output || typeof output !== 'object') return;
    const o = output as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : undefined;
    if (!url) return;
    const provider = typeof o.provider === 'string' ? o.provider : toolName;
    const kind = typeof o.kind === 'string' ? o.kind : 'artifact';
    const title = typeof o.title === 'string' ? o.title : `${provider} · ${kind}`;
    this.add({ provider, kind, title, url });
  }

  toArray(): Source[] {
    return this.entries.slice();
  }
}
```

Inside `runAgent`, before the loop:

```typescript
  const sources = new SourceCollector();
```

Inside the dispatch try block, after `tool.run`:

```typescript
        const output = await tool.run(ctx, use.input);
        if (use.name === 'search') {
          sources.ingestSearchResult(output);
        } else if (!META_TOOLS.has(use.name)) {
          sources.ingestArtifact(use.name, output);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
        });
```

Replace every `return { answer: text, sources: [] };` in the loop with:

```typescript
      return { answer: text, sources: sources.toArray() };
```

- [ ] **Step 4: Run — all tests pass**

```bash
pnpm --filter @holo/worker test slack-bot-agent
```

Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/agent.ts apps/worker/test/slack-bot-agent.test.ts
git commit -m "feat(worker): collect sources from search results and get_* artifacts"
```

---

## Task 10: Slack block renderer for agent answer

**Files:**
- Create: `apps/worker/src/slack-bot/blocks.ts`
- Create: `apps/worker/test/slack-bot-blocks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/test/slack-bot-blocks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  buildAgentAnswerBlocks,
  buildErrorBlocks,
} from '../src/slack-bot/blocks';
import type { Source } from '../src/slack-bot/agent';

describe('buildAgentAnswerBlocks', () => {
  it('renders prose, divider, sources header, and one context per source', () => {
    const sources: Source[] = [
      { provider: 'github', kind: 'doc', title: 'README', url: 'https://github.com/a/b' },
      { provider: 'notion', kind: 'doc', title: 'Runbook', url: 'https://www.notion.so/x' },
    ];
    const blocks = buildAgentAnswerBlocks('Deploys via *Vercel*.', sources);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Deploys via *Vercel*.' },
    });
    expect(blocks[1]).toEqual({ type: 'divider' });
    expect(blocks[2]).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '*Sources*' }],
    });
    expect(blocks[3]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'github · doc · <https://github.com/a/b|README>' },
      ],
    });
    expect(blocks[4]).toEqual({
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: 'notion · doc · <https://www.notion.so/x|Runbook>' },
      ],
    });
  });

  it('omits the divider and sources header when sources is empty', () => {
    const blocks = buildAgentAnswerBlocks('No sources used.', []);
    expect(blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: 'No sources used.' } },
    ]);
  });
});

describe('buildErrorBlocks', () => {
  it('renders a single section with the standard error message', () => {
    const blocks = buildErrorBlocks();
    expect(blocks).toEqual([
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Something went wrong answering that — try again, or rephrase.',
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run — must fail (file does not exist)**

```bash
pnpm --filter @holo/worker test slack-bot-blocks
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/worker/src/slack-bot/blocks.ts`**

```typescript
import type { SlackBlock } from '@holo/connectors';
import type { Source } from './agent.js';

const ERROR_MESSAGE = 'Something went wrong answering that — try again, or rephrase.';

export function buildAgentAnswerBlocks(
  answer: string,
  sources: Source[],
): SlackBlock[] {
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: answer } },
  ];
  if (sources.length === 0) return blocks;

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: '*Sources*' }],
  });
  for (const s of sources) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${s.provider} · ${s.kind} · <${s.url}|${s.title}>`,
        },
      ],
    });
  }
  return blocks;
}

export function buildErrorBlocks(): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: ERROR_MESSAGE } },
  ];
}

export const ERROR_FALLBACK_TEXT = ERROR_MESSAGE;
```

If `SlackBlock` does not export a `'context'` variant, extend the type via the connectors package or use a local widened type. Check `packages/connectors/src/slack/*.ts` for the SlackBlock definition first; if `context` is missing, add it to the union there.

- [ ] **Step 4: Run — all tests pass**

```bash
pnpm --filter @holo/worker test slack-bot-blocks
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/slack-bot/blocks.ts apps/worker/test/slack-bot-blocks.test.ts packages/connectors
git commit -m "feat(worker): Slack block renderer for agent answers and errors"
```

---

## Task 11: Wire `runAgent` into the Slack handler (replace `search`)

**Files:**
- Modify: `apps/worker/src/slack-bot/handler.ts`
- Modify: `apps/worker/test/slack-bot-handler.test.ts`

- [ ] **Step 1: Update `apps/worker/test/slack-bot-handler.test.ts`**

Replace the existing tests' `searchImpl` injection with `agentImpl`. Read the current file and edit each `searchImpl: ...` call to provide an `agentImpl: async () => ({ answer: '...', sources: [] })` instead. Update assertions that referenced `searchImpl.mock.calls[0][0].q` to use `agentImpl.mock.calls[0][0].question` (the new shape).

Add one new test:

```typescript
it('renders the agent answer with sources footer for app_mention', async () => {
  const db = makeFakeDb({
    sources: [{ organizationId: 'org-1' }],
    credentials: [
      { accessToken: 'xoxb-test', lastRefreshedAt: null, connectedAt: new Date('2026-01-01') },
    ],
  });
  // Stub Slack client by capturing fetch posts
  const fetchImpl = vi.fn(async () => new Response('{"ok":true,"ts":"1.1","channel":"C1"}', { status: 200 })) as unknown as typeof fetch;
  const agentImpl = vi.fn(async () => ({
    answer: 'Deploys via Vercel.',
    sources: [
      { provider: 'github', kind: 'doc', title: 'DEPLOY', url: 'https://github.com/a/b' },
    ],
  }));

  const result = await handleSlackBotJob(
    {
      kind: 'app_mention',
      teamId: 'TGOOD',
      channel: 'C1',
      threadTs: '1.0',
      asker: 'U1',
      text: '<@UBOT> how do we deploy?',
    },
    { db, fetchImpl, agentImpl },
  );

  expect(result).toEqual({ ok: true });
  expect(agentImpl).toHaveBeenCalledTimes(1);
  expect(agentImpl.mock.calls[0][0]).toMatchObject({
    organizationId: 'org-1',
    userSubjects: ['org:org-1'],
    question: 'how do we deploy?',
  });
});

it('posts the standard error message when the agent throws', async () => {
  const db = makeFakeDb({
    sources: [{ organizationId: 'org-1' }],
    credentials: [
      { accessToken: 'xoxb-test', lastRefreshedAt: null, connectedAt: new Date('2026-01-01') },
    ],
  });
  const fetchImpl = vi.fn(async () => new Response('{"ok":true,"ts":"1.1","channel":"C1"}', { status: 200 })) as unknown as typeof fetch;
  const agentImpl = vi.fn(async () => {
    throw new Error('anthropic api error');
  });

  const result = await handleSlackBotJob(
    {
      kind: 'app_mention',
      teamId: 'TGOOD',
      channel: 'C1',
      threadTs: '1.0',
      asker: 'U1',
      text: '<@UBOT> hi',
    },
    { db, fetchImpl, agentImpl },
  );

  expect(result).toEqual({ ok: true });
  // Two posts: placeholder, then chat.update with error blocks.
  // Inspect the chat.update body for the error message.
  const calls = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls;
  const updateCall = calls.find((c) => String(c[0]).includes('chat.update'));
  expect(updateCall).toBeDefined();
  const body = JSON.parse((updateCall![1] as RequestInit).body as string);
  expect(body.text).toContain('Something went wrong');
});
```

- [ ] **Step 2: Run — must fail**

```bash
pnpm --filter @holo/worker test slack-bot-handler
```

Expected: FAIL — `agentImpl` is not a recognized dep, old `searchImpl` still wired.

- [ ] **Step 3: Edit `apps/worker/src/slack-bot/handler.ts`**

Replace imports:

```typescript
import { runAgent, type AgentResult } from './agent.js';
import { buildAgentAnswerBlocks, buildErrorBlocks, ERROR_FALLBACK_TEXT } from './blocks.js';
import { listTools } from '@holo/agent-tools';
import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
```

Remove imports of `search`, `SearchResult`, and the old `buildAnswerBlocks`. Delete the `buildAnswerBlocks` function and the `truncate` helper if no longer used.

Replace the `SlackBotHandlerDeps` interface:

```typescript
export interface SlackBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /** Override for tests. Defaults to runAgent with a fresh Anthropic client. */
  agentImpl?: (input: {
    db: DB;
    organizationId: string;
    userSubjects: string[];
    question: string;
  }) => Promise<AgentResult>;
  /** Required in production; injected by the processor. */
  anthropicApiKey?: string;
}
```

Add an org-name lookup helper:

```typescript
async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}
```

Replace the body of `handleSlackBotJob`. After `resolveWorkspace`, `cleanQuery`, and the empty-query guard, build the answer:

```typescript
  const orgName = await fetchOrgName(deps.db, workspace.organizationId);
  const tools = await listTools({
    db: deps.db,
    organizationId: workspace.organizationId,
    userSubjects,
  });

  const agentRunner =
    deps.agentImpl ??
    (async (input) => {
      if (!deps.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      const client = new Anthropic({ apiKey: deps.anthropicApiKey });
      return runAgent({
        db: input.db,
        organizationId: input.organizationId,
        userSubjects: input.userSubjects,
        question: input.question,
        client,
        tools,
        orgName,
      });
    });

  let agentResult: AgentResult;
  try {
    agentResult = await agentRunner({
      db: deps.db,
      organizationId: workspace.organizationId,
      userSubjects,
      question: query,
    });
  } catch (err) {
    await postAgentError({ client, channel: job.channel, threadTs: 'threadTs' in job ? job.threadTs : undefined, fetchImpl: deps.fetchImpl });
    return { ok: true };
  }

  await postAgentAnswer({
    client,
    channel: job.channel,
    threadTs: 'threadTs' in job ? job.threadTs : undefined,
    answer: agentResult.answer,
    sources: agentResult.sources,
  });
```

Add the two helpers (replace `answerInChannel`):

```typescript
async function postAgentAnswer(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  answer: string;
  sources: Source[];
}): Promise<void> {
  const placeholder = await args.client.chatPostMessage({
    channel: args.channel,
    text: PLACEHOLDER_TEXT,
    thread_ts: args.threadTs,
  });
  const blocks = buildAgentAnswerBlocks(args.answer, args.sources);
  const fallback = args.answer.slice(0, 200);
  if (placeholder.ok && placeholder.ts && placeholder.channel) {
    await args.client.chatUpdate({
      channel: placeholder.channel,
      ts: placeholder.ts,
      text: fallback,
      blocks,
    });
    return;
  }
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: fallback,
    blocks,
  });
}

async function postAgentError(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: ERROR_FALLBACK_TEXT,
    blocks: buildErrorBlocks(),
  });
}
```

Import `Source` from `./agent.js`. Update the slash-command branch the same way: call the agent instead of `search`; on error, POST the error fallback to `responseUrl` (ephemeral). Replace `postSlashResponse` to take `{ answer, sources }` and to handle the error case via `buildErrorBlocks`.

For slash command:

```typescript
  if (job.kind === 'slash_command') {
    const trimmed = job.text.trim();
    const isPublic = trimmed.startsWith('--public ') || trimmed === '--public';
    const query = isPublic ? trimmed.replace(/^--public\s*/, '') : trimmed;
    if (!query) {
      await postSlashResponse({
        responseUrl: job.responseUrl,
        inChannel: false,
        answer: 'Ask me a question — e.g. `/holo what is the deploy process`',
        sources: [],
        fetchImpl: deps.fetchImpl,
      });
      return { ok: true };
    }
    let result: AgentResult;
    try {
      result = await agentRunner({
        db: deps.db,
        organizationId: workspace.organizationId,
        userSubjects,
        question: query,
      });
    } catch {
      await postSlashResponse({
        responseUrl: job.responseUrl,
        inChannel: false,
        answer: ERROR_FALLBACK_TEXT,
        sources: [],
        fetchImpl: deps.fetchImpl,
      });
      return { ok: true };
    }
    await postSlashResponse({
      responseUrl: job.responseUrl,
      inChannel: isPublic,
      answer: result.answer,
      sources: result.sources,
      fetchImpl: deps.fetchImpl,
    });
    return { ok: true };
  }
```

And `postSlashResponse`:

```typescript
async function postSlashResponse(args: {
  responseUrl: string;
  inChannel: boolean;
  answer: string;
  sources: Source[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const blocks = buildAgentAnswerBlocks(args.answer, args.sources);
  await fetchImpl(args.responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: args.inChannel ? 'in_channel' : 'ephemeral',
      replace_original: true,
      text: args.answer.slice(0, 200),
      blocks,
    }),
  });
}
```

- [ ] **Step 4: Wire the API key from the worker processor**

Find `apps/worker/src/slack-bot/slack-bot.processor.ts` and the call site that builds `SlackBotHandlerDeps`. Inject `process.env.ANTHROPIC_API_KEY` (the worker already loads the env). For the processor file, add:

```typescript
import { parseEnv } from '@holo/env';
// ... in the processor constructor or method:
const env = parseEnv(process.env);
// ... pass to handler:
return handleSlackBotJob(job, {
  db: this.db,
  anthropicApiKey: env.ANTHROPIC_API_KEY,
});
```

If the existing processor already calls `parseEnv` once, reuse that instance.

- [ ] **Step 5: Run all worker tests**

```bash
pnpm --filter @holo/worker test
pnpm --filter @holo/worker typecheck
```

Expected: all pass. If existing tests in `slack-bot-handler.test.ts` that referenced `searchImpl` weren't updated in Step 1, fix them now.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/slack-bot apps/worker/test/slack-bot-handler.test.ts
git commit -m "feat(worker): route Slack bot through runAgent with sources footer"
```

---

## Task 12: Make `ANTHROPIC_API_KEY` required for worker startup

**Files:**
- Modify: `packages/env/src/index.ts` (no schema change — keep optional globally)
- Modify: `apps/worker/src/main.ts`

The env package keeps `ANTHROPIC_API_KEY` optional (gateway and other services don't need it). The worker validates at boot.

- [ ] **Step 1: Add a startup check to `apps/worker/src/main.ts`**

Read the file first. After `parseEnv(process.env)`, add:

```typescript
if (!env.ANTHROPIC_API_KEY) {
  // Worker requires this for the Slack bot agent. Fail fast at boot rather
  // than silently returning errors to every Slack mention.
  throw new Error('ANTHROPIC_API_KEY is required for the worker');
}
```

- [ ] **Step 2: Build + verify**

```bash
pnpm --filter @holo/worker typecheck
pnpm --filter @holo/worker test
```

Expected: pass.

- [ ] **Step 3: Update `.env.example` if it exists**

```bash
grep -l "ANTHROPIC_API_KEY" .env.example .env.sample 2>/dev/null
```

If a sample file exists, ensure `ANTHROPIC_API_KEY=` is present with a comment: `# Required for the worker (Slack bot agent).`

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/main.ts .env.example
git commit -m "chore(worker): fail fast when ANTHROPIC_API_KEY is missing"
```

---

## Task 13: End-to-end smoke check (manual)

This task isn't automated — it verifies the full path before merging.

- [ ] **Step 1: Set `ANTHROPIC_API_KEY` in `.env`**

- [ ] **Step 2: Run the worker locally**

```bash
pnpm --filter @holo/worker dev
```

- [ ] **Step 3: Trigger a Slack `app_mention` against a connected workspace**

In a Slack channel where the bot is installed, post: `@holo what do we know about onboarding?`

- [ ] **Step 4: Verify the output**

Expected: a single Slack message with synthesized prose followed by a `*Sources*` footer with 1–8 entries linking to GitHub/Notion/etc. artifacts.

- [ ] **Step 5: Trigger a deliberate failure**

Temporarily set `ANTHROPIC_API_KEY=invalid` in `.env`, restart the worker, and post another `@holo` mention.

Expected: the message reads "Something went wrong answering that — try again, or rephrase." Worker logs an error with the job id. Restore the real key.

- [ ] **Step 6: Commit (no code changes — just validation)**

If any defects surfaced during smoke, file them as separate fix-up tasks; don't bundle into this plan.
