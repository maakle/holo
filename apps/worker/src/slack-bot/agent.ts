import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type {
  ToolDefinition,
  WireAnswerClaim,
  WireCitation,
  WireSearchCoverage,
} from '@holo/agent-tools';
import {
  CLAIMS_SUFFIX,
  EMIT_CLAIMS_TOOL_DECL,
  appendUnverifiedNoteIfNeeded,
  applyClaimGuardrails,
  claimToWire,
  parseEmitClaimsInput,
  renumberSearchOutput,
} from '@holo/agent-tools';
import { resolveAnthropicAgentModel } from '@holo/llm';

export interface Source {
  provider: string;
  kind: string;
  title: string;
  /**
   * Deep link to the source artifact. Undefined when the provider doesn't
   * have a stable URL pattern yet (e.g. Salesforce, HubSpot today). The
   * Slack renderer falls back to label-only when this is missing.
   */
  url?: string;
}

export interface AgentResult {
  /**
   * Stable identifier minted at the top of every `runAgent`. Threaded into
   * the slack reply via `slack_answer_index` (RFC-0008 extension) so a
   * subsequent reaction_added webhook can attribute feedback back to the
   * exact orchestrator turn that produced the answer.
   */
  answerId: string;
  answer: string;
  sources: Source[];
  /**
   * Structured claims envelope (RFC-0007). Empty when the model returned
   * plain text without calling `emit_claims` (e.g. a conversational reply
   * with no factual claims). The slack reply text already carries an
   * appended "Note: I couldn't verify N claims" footer when any claim
   * was hard-gated to `unverified`, so slack callers don't need to render
   * `claims` — but the structured envelope is here for completeness and
   * for feedback-loop persistence (RFC-0008).
   */
  claims: WireAnswerClaim[];
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
  /** Optional trace callback; receives one event per model call and per tool call. */
  logEvent?: (event: 'model_call' | 'tool_call' | 'tool_error', fields: Record<string, unknown>) => void;
}

export class AgentRunawayError extends Error {
  constructor(public reason: 'tool_call_cap' | 'wall_clock_cap', message: string) {
    super(message);
    this.name = 'AgentRunawayError';
  }
}

const SYSTEM_PROMPT_TEMPLATE = `You are holo, a knowledge assistant for {org_name}. You have tools to search and fetch content from this organization's connected sources and to call any custom tools the organization has registered. Call whichever tools you need to answer the user's question — do not assume which sources are available; let the tool list and tool results tell you.

Rules:
- Ground every claim in a tool result. Do not speculate.
- Cite your sources. Each \`search\` tool result includes a \`citations\` array with 1-based \`index\` values. When you state a fact grounded in one of those results, append the matching bracket reference like \`[1]\` (or \`[2][3]\` for multiple). Do not invent indices and do not cite results you didn't use.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack mrkdwn), not markdown headers (#) or fenced code blocks unless quoting code. Bullets with \`- \` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.`;

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

const META_TOOLS = new Set(['list_skills', 'get_skill', 'execute_skill']);

/**
 * Convert a renumbered citation envelope into the `Source` shape the Slack
 * renderer consumes. Position N-1 in the returned array corresponds to the
 * `[N]` reference the model is told to emit in the answer text.
 */
function citationToSource(c: WireCitation): Source {
  return {
    provider: c.provider,
    kind: c.artifact_kind,
    title: c.label,
    ...(c.url !== undefined ? { url: c.url } : {}),
  };
}

/**
 * Best-effort source from a non-search artifact tool. Today this only fires
 * for custom tools that emit a `url` field on their output (built-in tools
 * other than `search` and `bash` don't surface citations this way). These
 * don't participate in the citation namespace — they get appended after the
 * numbered citations as supplementary entries the model can describe but
 * not `[N]`-reference.
 */
function artifactToSource(toolName: string, output: unknown): Source | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const o = output as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url : undefined;
  if (!url) return undefined;
  const provider = typeof o.provider === 'string' ? o.provider : toolName;
  const kind = typeof o.kind === 'string' ? o.kind : 'artifact';
  const title = typeof o.title === 'string' ? o.title : `${provider} · ${kind}`;
  return { provider, kind, title, url };
}

/**
 * Best-effort sources from a `bash` tool call.
 *
 * `cat /sample/docs/doc-rebellion-charter.md` references one file in its
 * script; `grep -rl Rebel /sample` returns several in its stdout. Both
 * shapes are evidence the model used those artifacts to compose the
 * answer — without this extraction the slack reply lists zero sources
 * even though the model just read a specific file end-to-end.
 *
 * Implementation: regex-scan the script + stdout for absolute paths under
 * any known FS root, build a Source per unique match pointing at the
 * dashboard's `/files/<path>` view, cap at 20 to keep the citation card
 * readable when grep returns hundreds.
 *
 * No DB round-trip in v1 — the dashboard already enriches each file with
 * kind / source / updatedAt when the user clicks through. If we later
 * want deep links to the underlying source system (a slack URL, github
 * PR URL, etc.) we'd look the artifact up by path here and read its
 * metadata.
 */
// Slack channel paths use `#` (e.g. `/slack/#engineering/...`), so the
// segment character class is broader than POSIX-clean.
const BASH_PATH_RE = /(?:^|[\s'"`,(])(\/[a-z][a-z0-9_-]*(?:\/[A-Za-z0-9#._-]+)+)/g;
const MAX_BASH_SOURCES_PER_CALL = 20;

/**
 * Roots emitted by the path-fn registry (packages/chunker/src/path-fn.ts)
 * plus the `/sample` root from sample-data. Restricting to this set keeps
 * the citation extractor from picking up genuine OS paths like `/tmp/...`
 * that an agent might mention in passing. Keep in sync if a new chunker
 * picks a new top-level root.
 */
const KNOWN_FS_ROOTS = new Set([
  'slack',
  'google-chat',
  'github',
  'notion',
  'grain',
  'pylon',
  'hubspot',
  'salesforce',
  'stripe',
  'mintlify',
  'openapi',
  'prismic',
  'webcrawl',
  'zendesk',
  'googledrive',
  'jira',
  'asana',
  'confluence',
  'airtable',
  'gitlab',
  'linear',
  'sample',
]);

export function extractBashSources(script: string, stdout: string): Source[] {
  const seen = new Set<string>();
  const sources: (Source & { __path: string })[] = [];
  const haystack = `${script}\n${stdout}`;
  for (const m of haystack.matchAll(BASH_PATH_RE)) {
    const p = m[1];
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const segs = p.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const root = segs[0]!;
    if (!KNOWN_FS_ROOTS.has(root)) continue;
    const title = segs[segs.length - 1]!;
    sources.push({
      provider: root,
      kind: 'file',
      title,
      url: `/files/${segs.map((s) => encodeURIComponent(s)).join('/')}`,
      __path: p,
    });
    if (sources.length >= MAX_BASH_SOURCES_PER_CALL) break;
  }
  // Strip the internal __path tag from the returned shape so callers see
  // the plain Source. resolveBashSourceUrls reads __path directly when
  // it's still present.
  return sources.map(({ __path: _p, ...s }) => s);
}

/**
 * Internal cousin of `extractBashSources` that preserves the underlying
 * virtual-FS path on each Source so `resolveBashSourceUrls` can do a
 * batched lookup. The path is *not* leaked outside the agent — callers
 * see only the public `Source` shape.
 */
function extractBashSourcesWithPath(
  script: string,
  stdout: string,
): (Source & { path: string })[] {
  const seen = new Set<string>();
  const sources: (Source & { path: string })[] = [];
  const haystack = `${script}\n${stdout}`;
  for (const m of haystack.matchAll(BASH_PATH_RE)) {
    const p = m[1];
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const segs = p.split('/').filter(Boolean);
    if (segs.length < 2) continue;
    const root = segs[0]!;
    if (!KNOWN_FS_ROOTS.has(root)) continue;
    const title = segs[segs.length - 1]!;
    sources.push({
      provider: root,
      kind: 'file',
      title,
      url: `/files/${segs.map((s) => encodeURIComponent(s)).join('/')}`,
      path: p,
    });
    if (sources.length >= MAX_BASH_SOURCES_PER_CALL) break;
  }
  return sources;
}

/**
 * Promote each source's URL from the dashboard `/files/<path>` view to the
 * real source-system URL (the actual slack thread, github PR, notion page,
 * stripe dashboard, …) by looking up `source_artifacts.source_url` for
 * every path in one round-trip.
 *
 * Falls back to the original `/files/<path>` URL when the row has no
 * stored source_url — sample-data kinds, salesforce records without a My
 * Domain, etc. Errors are swallowed (returns the inputs unchanged) so a
 * DB blip during enrichment never costs the model its tool output.
 */
export async function resolveBashSourceUrls(
  db: DB,
  organizationId: string,
  sources: (Source & { path: string })[],
): Promise<Source[]> {
  if (sources.length === 0) return [];
  const paths = sources.map((s) => s.path);
  let urlByPath = new Map<string, string>();
  try {
    const rows = await db
      .select({ path: schema.sourceArtifacts.path, sourceUrl: schema.sourceArtifacts.sourceUrl })
      .from(schema.sourceArtifacts)
      .where(
        and(
          eq(schema.sourceArtifacts.organizationId, organizationId),
          inArray(schema.sourceArtifacts.path, paths),
          isNull(schema.sourceArtifacts.deletedAt),
        ),
      );
    urlByPath = new Map(
      rows
        .filter((r): r is { path: string; sourceUrl: string } => !!r.sourceUrl)
        .map((r) => [r.path, r.sourceUrl]),
    );
  } catch {
    // Best-effort enrichment — if the lookup fails the model still gets
    // back the dashboard URLs and the slack reply still renders.
  }
  return sources.map((s) => {
    const realUrl = urlByPath.get(s.path);
    const { path: _p, ...rest } = s;
    return realUrl ? { ...rest, url: realUrl } : rest;
  });
}

// Anthropic's tool API requires `type: "object"` at the root of input_schema
// AND rejects `anyOf`/`oneOf`/`allOf` at the top level. Zod's z.toJSONSchema
// emits exactly those for unions and refined objects (e.g. get_skill, or
// custom tools). Flatten the branches into a merged `properties` map; the
// tool runner still validates via the original zod schema at runtime.
function toAnthropicInputSchema(raw: unknown): Record<string, unknown> {
  const schema = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const branches =
    (schema['anyOf'] as unknown) ??
    (schema['oneOf'] as unknown) ??
    (schema['allOf'] as unknown);

  if (Array.isArray(branches)) {
    const properties: Record<string, unknown> = {};
    for (const branch of branches) {
      if (branch && typeof branch === 'object') {
        const branchProps = (branch as { properties?: Record<string, unknown> }).properties;
        if (branchProps) Object.assign(properties, branchProps);
      }
    }
    const { anyOf: _a, oneOf: _o, allOf: _al, type: _t, properties: _p, ...rest } = schema;
    return { ...rest, type: 'object', properties };
  }

  if (schema['type'] === 'object') return schema;
  return { type: 'object', ...schema };
}

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  // RFC-0008: stable id minted at the top of every run so a slack reply can
  // be indexed in `slack_answer_index` and a reaction_added event later can
  // attribute feedback back to this exact turn.
  const answerId = randomUUID();
  // RFC-0007: the slack bot uses the same claims protocol as the web chat.
  // Slack can't render confidence chips, so the user-visible signal is the
  // "Note: I couldn't verify N claims" footer that `appendUnverifiedNoteIfNeeded`
  // tacks onto the answer text below — same wording the REST surface uses.
  const system = `${SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName)}${CLAIMS_SUFFIX}`;
  const anthropicTools: AnthropicTool[] = [
    ...deps.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toAnthropicInputSchema(t.inputSchema),
    })),
    {
      name: EMIT_CLAIMS_TOOL_DECL.name,
      description: EMIT_CLAIMS_TOOL_DECL.description,
      input_schema: toAnthropicInputSchema(EMIT_CLAIMS_TOOL_DECL.inputSchema),
    },
  ];
  const toolByName = new Map(deps.tools.map((t) => [t.name, t]));

  const ctx = {
    db: deps.db,
    organizationId: deps.organizationId,
    userSubjects: deps.userSubjects,
  };

  const messages: Message[] = [{ role: 'user', content: deps.question }];
  const maxToolCalls = deps.maxToolCalls ?? 20;
  let toolCallCount = 0;
  const wallClockMs = deps.wallClockMs ?? 60_000;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  // Citation accumulator — every `search` tool result gets renumbered into
  // this monotonic 1..N namespace before reaching the model, so `[N]` in the
  // final answer text resolves unambiguously to `citationsAcc[N-1]`.
  const citationsAcc: WireCitation[] = [];
  const coverageAcc: WireSearchCoverage[] = [];
  // Supplementary sources from non-search tools (custom tools that emit a
  // `url` on their output). Not part of the citation namespace; appended
  // after the numbered list.
  const artifactSources: Source[] = [];
  const logEvent = deps.logEvent ?? (() => {});
  let modelCallCount = 0;

  const buildSources = (): Source[] => [
    ...citationsAcc.map(citationToSource),
    ...artifactSources,
  ];

  while (true) {
    if (now() - startedAt > wallClockMs) {
      throw new AgentRunawayError(
        'wall_clock_cap',
        `agent exceeded wall clock budget (${wallClockMs}ms)`,
      );
    }
    const modelStart = now();
    const model = resolveAnthropicAgentModel();
    const response = (await deps.client.messages.create({
      model,
      max_tokens: 4096,
      system,
      messages: [...messages] as never,
      tools: anthropicTools as never,
    })) as {
      stop_reason: string;
      content: ContentBlock[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    modelCallCount += 1;
    logEvent('model_call', {
      callIndex: modelCallCount,
      model,
      durationMs: now() - modelStart,
      stopReason: response.stop_reason,
      elapsedMs: now() - startedAt,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      cacheCreationInputTokens: response.usage?.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage?.cache_read_input_tokens,
    });

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'max_tokens') {
        console.warn(
          `[runAgent] response truncated by max_tokens for org=${deps.organizationId}`,
        );
      }
      const text = response.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      // Bare end_turn fallback (no `emit_claims` call). The answer is still
      // useful; we just have no structured claims to enforce. Return an
      // empty `claims` array — slack reply renders normally without the
      // "couldn't verify" footer.
      return { answerId, answer: text, sources: buildSources(), claims: [] };
    }

    const toolUses = response.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    );

    // Terminal `emit_claims` (RFC-0007). The model calls this instead of
    // ending with plain text; we apply the same server-side downgrade +
    // hard-gate as the web orchestrator and append a "couldn't verify"
    // footer to the answer text when any claim ended up `unverified`.
    const emitClaimsUse = toolUses.find((t) => t.name === EMIT_CLAIMS_TOOL_DECL.name);
    if (emitClaimsUse) {
      const { answerText, claims: rawClaims } = parseEmitClaimsInput(emitClaimsUse.input);
      const enforced = applyClaimGuardrails(rawClaims);
      const finalAnswer = appendUnverifiedNoteIfNeeded(answerText, enforced);
      return {
        answerId,
        answer: finalAnswer,
        sources: buildSources(),
        claims: enforced.map(claimToWire),
      };
    }

    const toolResults: ToolResultBlock[] = [];
    for (const use of toolUses) {
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        throw new AgentRunawayError(
          'tool_call_cap',
          `agent exceeded max tool calls (${maxToolCalls})`,
        );
      }
      if (now() - startedAt > wallClockMs) {
        throw new AgentRunawayError(
          'wall_clock_cap',
          `agent exceeded wall clock budget (${wallClockMs}ms)`,
        );
      }
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
      const toolStart = now();
      try {
        const rawOutput = await tool.run(ctx, use.input);
        // For `search` tool calls, renumber the per-call citation indices
        // into the turn-global namespace before the output reaches both the
        // model (via JSON.stringify) and the source list. Mirrors the web
        // orchestrator so `[N]` semantics are identical across surfaces.
        const output =
          use.name === 'search'
            ? renumberSearchOutput(rawOutput, citationsAcc, coverageAcc)
            : rawOutput;
        logEvent('tool_call', {
          tool: use.name,
          input: use.input,
          output,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
        });
        if (use.name === 'bash') {
          const script = String(
            (use.input as { script?: unknown } | null)?.script ?? '',
          );
          const stdout = String(
            (output as { stdout?: unknown } | null)?.stdout ?? '',
          );
          // Two passes: extract synchronously (cheap regex), then promote
          // each /files/<path> URL to the real source-system URL via one
          // batched DB lookup. Sources whose row has no source_url
          // (sample-data, salesforce without My Domain, custom connectors)
          // stay on the dashboard URL — never broken, just less-deep.
          const extracted = extractBashSourcesWithPath(script, stdout);
          const resolved = await resolveBashSourceUrls(deps.db, deps.organizationId, extracted);
          for (const src of resolved) {
            // Dedupe against anything already on the list — repeated
            // `cat` of the same path across tool calls is common.
            if (!artifactSources.some((s) => s.url === src.url)) {
              artifactSources.push(src);
            }
          }
        } else if (use.name !== 'search' && !META_TOOLS.has(use.name)) {
          const src = artifactToSource(use.name, output);
          if (src) artifactSources.push(src);
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: JSON.stringify(output),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logEvent('tool_error', {
          tool: use.name,
          input: use.input,
          durationMs: now() - toolStart,
          elapsedMs: now() - startedAt,
          error: message,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `tool error: ${message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }
}
