import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import type {
  ToolDefinition,
  WireAnswerClaim,
  WireCitation,
} from '@holo/agent-tools';
import {
  runAgentLoop,
  type AgentLoopEvent,
  type AgentLoopToolCall,
} from '@holo/agent-tools';
import { CLAIMS_SUFFIX } from '@holo/agent-tools';
import type { LLMClient, LLMStopReason, LLMUsage } from '@holo/llm';
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

/**
 * Legacy event signature kept stable for `agent-runner.ts` consumers
 * (`recordAgentEventForSlack`, `progressTextForEvent`). The slack bot ran
 * on the raw Anthropic SDK before sharing the loop with the web chat
 * surface; downstream audit + Slack-mrkdwn progress text was written
 * against this shape. We translate the shared loop's structured events
 * into this form at the wrapper boundary.
 */
export type SlackAgentLogEvent = 'model_call' | 'tool_call' | 'tool_error';

export interface RunAgentDeps {
  db: DB;
  organizationId: string;
  userSubjects: string[];
  question: string;
  /** Injected for tests. In production, the agent-runner constructs an
   * `AnthropicLLMClient` from `ANTHROPIC_API_KEY`. */
  llm: LLMClient;
  /** Injected for tests. In production, call `listTools()` from
   * `@holo/agent-tools`. */
  tools: ToolDefinition[];
  /** Org display name for the system prompt. */
  orgName: string;
  /** Override the model. Defaults to `resolveAnthropicAgentModel()` so a
   * deploy can flip Sonnet→Opus via `ANTHROPIC_AGENT_MODEL`. */
  model?: string;
  /** Defaults to 20. */
  maxToolCalls?: number;
  /** Defaults to 60_000 ms. */
  wallClockMs?: number;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
  /** Optional trace callback; receives one event per model call and per tool call. */
  logEvent?: (event: SlackAgentLogEvent, fields: Record<string, unknown>) => void;
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
- Cite sources INLINE with verbatim identifiers ONLY. Each \`search\` tool result includes a \`citations\` array with a \`label\` (e.g. "Pylon #19584", "PR #1234 · org/repo", "Grain — Title") and a \`url\`. When stating a fact, write the label inline (e.g. "TICKET-19584 confirmed this") so a teammate skimming the message can immediately see the source without scrolling to the appended source list.
- NEVER write bracketed footnote numbers like \`[1]\`, \`[4]\`, \`[51]\` in the answer text. The structured claims envelope (emit_claims tool) handles index-based references separately — they belong only in that envelope's \`citation_indices\` field, never in the prose the user reads. Bracketed numbers in prose look like hallucinations to readers and add no value beyond the inline label and the system-appended source list.
- Prefer the most authoritative source available. If a docs page directly answers the question, lead with that rather than a related call recording or ticket where someone asked the same question.
- Do not punt when retrievable evidence exists. If your search results contain the answer, give a confident answer with citations. Reserve "I don't know" for cases where the search genuinely returned nothing relevant.
- For questions that span tickets, calls, and docs (e.g. "who asked for X", "how does X work in tool Y"), run multiple targeted searches before answering. Don't stop at the first result if the question has breadth.
- Keep answers concise and Slack-friendly: use *bold* and _italic_ (Slack mrkdwn), not markdown headers (#) or fenced code blocks unless quoting code. Bullets with \`- \` are fine.
- If you cannot find an answer, say so directly — do not invent one.
- Do not list sources at the end of your answer; the system appends them.`;

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

/**
 * Convert a single shared-loop event into the legacy slack `logEvent`
 * shape. Returns null for events that the slack audit + progress paths
 * never consumed (`model_start`, `tool_start`).
 */
function adaptEventForSlack(
  event: AgentLoopEvent,
  model: string,
):
  | { kind: SlackAgentLogEvent; fields: Record<string, unknown> }
  | null {
  if (event.type === 'model_end') {
    const usage: LLMUsage | undefined = event.usage;
    return {
      kind: 'model_call',
      fields: {
        callIndex: event.modelCall,
        model,
        durationMs: event.durationMs,
        stopReason: event.stopReason as LLMStopReason,
        elapsedMs: event.elapsedMs,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        cacheCreationInputTokens: usage?.cacheCreationInputTokens,
        cacheReadInputTokens: usage?.cacheReadInputTokens,
      },
    };
  }
  if (event.type === 'tool_end') {
    if (event.isError) {
      return {
        kind: 'tool_error',
        fields: {
          tool: event.name,
          input: event.input,
          durationMs: event.durationMs,
          elapsedMs: event.elapsedMs,
          error: typeof event.output === 'string' ? event.output : String(event.output ?? ''),
        },
      };
    }
    return {
      kind: 'tool_call',
      fields: {
        tool: event.name,
        input: event.input,
        output: event.output,
        durationMs: event.durationMs,
        elapsedMs: event.elapsedMs,
      },
    };
  }
  return null;
}

/**
 * Walk the trace from `runAgentLoop` and accumulate slack-side sources.
 * Source extraction lives outside the shared loop because it's a
 * surface-specific concern: the web chat surfaces citations natively and
 * doesn't need bash-path or artifact extraction, but Slack does.
 */
async function buildSlackSources(
  db: DB,
  organizationId: string,
  citations: WireCitation[],
  toolCalls: AgentLoopToolCall[],
): Promise<Source[]> {
  const sources: Source[] = citations.map(citationToSource);
  const allBashPaths: (Source & { path: string })[] = [];
  const seenBashPaths = new Set<string>();

  for (const call of toolCalls) {
    if (call.isError) continue;
    if (call.name === 'bash') {
      const script = String(
        (call.input as { script?: unknown } | null)?.script ?? '',
      );
      const stdout = String(
        (call.output as { stdout?: unknown } | null)?.stdout ?? '',
      );
      for (const src of extractBashSourcesWithPath(script, stdout)) {
        if (seenBashPaths.has(src.path)) continue;
        seenBashPaths.add(src.path);
        allBashPaths.push(src);
      }
    } else if (call.name !== 'search' && !META_TOOLS.has(call.name)) {
      const src = artifactToSource(call.name, call.output);
      if (src && !sources.some((s) => s.url === src.url)) {
        sources.push(src);
      }
    }
  }

  // One batched DB lookup for every bash-extracted path, then merge in
  // url-order. Sources whose row has no stored source_url stay on the
  // dashboard `/files/<path>` URL — never broken, just less-deep.
  const resolved = await resolveBashSourceUrls(db, organizationId, allBashPaths);
  for (const src of resolved) {
    if (!sources.some((s) => s.url === src.url)) {
      sources.push(src);
    }
  }
  return sources;
}

export async function runAgent(deps: RunAgentDeps): Promise<AgentResult> {
  // RFC-0007: same claims protocol the web chat uses. Slack can't render
  // confidence chips, so the user-visible signal is the "Note: I couldn't
  // verify N claims" footer that `appendUnverifiedNoteIfNeeded` (applied
  // inside the shared loop) tacks onto the answer text.
  const system = `${SYSTEM_PROMPT_TEMPLATE.replace('{org_name}', deps.orgName)}${CLAIMS_SUFFIX}`;
  const model = deps.model ?? resolveAnthropicAgentModel();
  const logEvent = deps.logEvent;

  const result = await runAgentLoop({
    llm: deps.llm,
    model,
    systemPrompt: system,
    tools: deps.tools,
    toolCtx: {
      db: deps.db,
      organizationId: deps.organizationId,
      userSubjects: deps.userSubjects,
    },
    initialMessages: [{ role: 'user', content: deps.question }],
    maxTokens: 4096,
    maxToolCalls: deps.maxToolCalls ?? 20,
    wallClockMs: deps.wallClockMs ?? 60_000,
    ...(deps.now ? { now: deps.now } : {}),
    ...(logEvent
      ? {
          onEvent: (event) => {
            const adapted = adaptEventForSlack(event, model);
            if (adapted) logEvent(adapted.kind, adapted.fields);
          },
        }
      : {}),
  });

  if (result.kind === 'wall_clock_exceeded') {
    throw new AgentRunawayError(
      'wall_clock_cap',
      `agent exceeded wall clock budget (${result.wallClockMs}ms)`,
    );
  }
  if (result.kind === 'tool_cap_exceeded') {
    throw new AgentRunawayError(
      'tool_call_cap',
      `agent exceeded max tool calls (${result.maxToolCalls})`,
    );
  }

  const sources = await buildSlackSources(
    deps.db,
    deps.organizationId,
    result.citations,
    result.toolCalls,
  );

  return {
    answerId: result.answerId,
    answer: result.answer,
    sources,
    claims: result.claims,
  };
}
