import Anthropic from '@anthropic-ai/sdk';
import { eq, and } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import {
  createSlackApiClient,
  type SlackApiClient,
} from '@holo/connectors';
import { listTools } from '@holo/agent-tools';
import { runAgent, type AgentResult, type Source } from './agent.js';
import { buildAgentAnswerBlocks, buildErrorBlocks, ERROR_FALLBACK_TEXT } from './blocks.js';

export type SlackBotJob =
  | {
      kind: 'app_mention';
      teamId: string;
      channel: string;
      threadTs: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'message_im';
      teamId: string;
      channel: string;
      threadTs?: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'slash_command';
      teamId: string;
      channel: string;
      asker: string;
      text: string;
      responseUrl: string;
    };

interface WorkspaceCreds {
  organizationId: string;
  accessToken: string;
}

/**
 * Resolve which workspace this Slack team_id maps to. We trust whichever
 * connectorCredentials row was registered with this team — the install path
 * upserts a `sources` row keyed by team_id, and connectorCredentials is
 * already scoped per (org, provider). Multiple users in one org could each
 * own a credentials row, but they all hold tokens for the same workspace, so
 * any of them works for outbound posting; we pick the most recently
 * refreshed one to maximize the chance the token is still valid.
 */
async function resolveWorkspace(db: DB, teamId: string): Promise<WorkspaceCreds | null> {
  const sourceRow = await db
    .select({ organizationId: schema.sources.organizationId })
    .from(schema.sources)
    .where(
      and(eq(schema.sources.provider, 'slack'), eq(schema.sources.externalId, teamId)),
    )
    .limit(1);
  if (!sourceRow[0]) return null;
  const orgId = sourceRow[0].organizationId;

  const credRows = await db
    .select({
      accessToken: schema.connectorCredentials.accessToken,
      lastRefreshedAt: schema.connectorCredentials.lastRefreshedAt,
      connectedAt: schema.connectorCredentials.connectedAt,
    })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, orgId),
        eq(schema.connectorCredentials.provider, 'slack'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    );
  const validRows = credRows.filter((r): r is typeof r & { accessToken: string } =>
    typeof r.accessToken === 'string' && r.accessToken.length > 0,
  );
  if (validRows.length === 0) return null;

  // Sort: most recently refreshed first; fall back to connectedAt.
  validRows.sort((a, b) => {
    const ta = (a.lastRefreshedAt ?? a.connectedAt).getTime();
    const tb = (b.lastRefreshedAt ?? b.connectedAt).getTime();
    return tb - ta;
  });
  const top = validRows[0];
  if (!top) return null;
  return { organizationId: orgId, accessToken: top.accessToken };
}

async function fetchOrgName(db: DB, organizationId: string): Promise<string> {
  const rows = await db
    .select({ name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.name ?? 'this organization';
}

/**
 * Strip a leading `<@UXXX>` mention so the search query is the user's actual
 * question, not our own bot ID. Slack puts the mention at the start of the
 * text for `app_mention` events.
 */
function cleanQuery(text: string): string {
  return text.replace(/^\s*<@[^>]+>\s*/, '').trim();
}

const PLACEHOLDER_TEXT = '_holo is thinking…_';

/**
 * Map an agent log event to a short Slack-friendly progress phrase. Returns
 * null when the event shouldn't trigger a placeholder update (e.g. the very
 * first model call — the placeholder already says "thinking").
 */
function progressTextForEvent(
  event: 'model_call' | 'tool_call' | 'tool_error',
  fields: Record<string, unknown>,
): string | null {
  if (event === 'tool_call' || event === 'tool_error') {
    const tool = String(fields.tool ?? '');
    if (tool === 'search') return '_🔍 searching your sources…_';
    if (
      tool === 'get_doc' ||
      tool === 'get_pr' ||
      tool === 'get_thread' ||
      tool === 'get_call' ||
      tool === 'get_ticket'
    ) {
      return '_📄 reading sources…_';
    }
    if (tool === 'list_skills' || tool === 'get_skill' || tool === 'execute_skill') {
      return '_🛠 using a skill…_';
    }
    return `_🛠 using ${tool}…_`;
  }
  if (event === 'model_call') {
    const callIndex = typeof fields.callIndex === 'number' ? fields.callIndex : 0;
    if (callIndex > 1) return '_🧠 reasoning…_';
    return null;
  }
  return null;
}

/**
 * Throttled chat.update wrapper. Slack's `chat.update` is Tier 3 and
 * rate-limits aggressively per-channel — we coalesce updates to one every
 * 750ms. The latest pending text always wins; transient intermediate states
 * may be skipped (fine — they're ephemeral). `flush` is a no-op here; the
 * caller does a final chat.update with the actual answer/error blocks.
 */
function makePlaceholderProgress(args: {
  client: SlackApiClient;
  channel: string;
  ts: string;
}): { update: (text: string) => void } {
  const intervalMs = 750;
  let lastSentAt = 0;
  let pendingText: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastSentText = PLACEHOLDER_TEXT;

  const send = async (text: string): Promise<void> => {
    if (text === lastSentText) return;
    lastSentText = text;
    lastSentAt = Date.now();
    try {
      await args.client.chatUpdate({
        channel: args.channel,
        ts: args.ts,
        text,
      });
    } catch {
      // Progress is best-effort; don't fail the agent if a chat.update slips.
    }
  };

  return {
    update: (text: string) => {
      pendingText = text;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= intervalMs) {
        const t = pendingText;
        pendingText = null;
        void send(t);
        return;
      }
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        if (pendingText !== null) {
          const t = pendingText;
          pendingText = null;
          void send(t);
        }
      }, intervalMs - elapsed);
    },
  };
}

/**
 * Finalize an existing placeholder with the agent's answer + sources. If no
 * placeholder was successfully posted (rate limit, scope, etc.), fall back to
 * a direct chat.postMessage so the user isn't left hanging.
 */
async function finalizeAgentAnswer(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  placeholder: { ts: string; channel: string } | null;
  answer: string;
  sources: Source[];
}): Promise<void> {
  const blocks = buildAgentAnswerBlocks(args.answer, args.sources);
  const fallback = args.answer || 'holo answered your question.';
  if (args.placeholder) {
    await args.client.chatUpdate({
      channel: args.placeholder.channel,
      ts: args.placeholder.ts,
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

/**
 * Replace a placeholder with the standard error message. Same fallback shape
 * as finalizeAgentAnswer.
 */
async function finalizeAgentError(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  placeholder: { ts: string; channel: string } | null;
}): Promise<void> {
  const blocks = buildErrorBlocks();
  if (args.placeholder) {
    await args.client.chatUpdate({
      channel: args.placeholder.channel,
      ts: args.placeholder.ts,
      text: ERROR_FALLBACK_TEXT,
      blocks,
    });
    return;
  }
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: ERROR_FALLBACK_TEXT,
    blocks,
  });
}

async function postSlashResponse(args: {
  responseUrl: string;
  inChannel: boolean;
  answer: string;
  sources: Source[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const blocks = args.answer
    ? buildAgentAnswerBlocks(args.answer, args.sources)
    : [
        {
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: 'Ask me a question — e.g. `/holo what do we know about onboarding?`',
          },
        },
      ];
  const fallback = args.answer || 'holo answered your question.';
  await fetchImpl(args.responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: args.inChannel ? 'in_channel' : 'ephemeral',
      replace_original: true,
      text: fallback,
      blocks,
    }),
  });
}

export interface SlackBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /**
   * Override the agent loop for tests. In production, the default factory
   * lazily creates an Anthropic client and calls listTools + runAgent.
   * Injecting this avoids touching either, which keeps tests light.
   */
  agentImpl?: (input: {
    db: DB;
    organizationId: string;
    userSubjects: string[];
    question: string;
    progress?: (text: string) => void;
  }) => Promise<AgentResult>;
  anthropicApiKey?: string;
  logError?: (message: string, err?: unknown) => void;
  logInfo?: (message: string, fields?: Record<string, unknown>) => void;
}

export async function handleSlackBotJob(
  job: SlackBotJob,
  deps: SlackBotHandlerDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const logError = deps.logError ?? ((msg, err) => console.error(msg, err));
  const logInfo = deps.logInfo ?? ((msg, fields) => console.log(msg, fields ?? {}));
  logInfo('slack-bot: job received', {
    kind: job.kind,
    teamId: job.teamId,
    channel: job.channel,
    asker: job.asker,
    textPreview: job.text.slice(0, 80),
  });
  const workspace = await resolveWorkspace(deps.db, job.teamId);
  if (!workspace) {
    logInfo('slack-bot: workspace not connected', { teamId: job.teamId });
    return { ok: false, reason: 'workspace_not_connected' };
  }
  logInfo('slack-bot: workspace resolved', {
    teamId: job.teamId,
    organizationId: workspace.organizationId,
  });

  const client = createSlackApiClient(workspace.accessToken, deps.fetchImpl);

  // Per-workspace ACL: bot answers using the workspace's full corpus
  // (subject `org:<id>`). No per-user filtering — confirmed product decision.
  const userSubjects = [`org:${workspace.organizationId}`];

  // Lazy default agent runner: only touches listTools + Anthropic when no
  // override is supplied. Tests inject `agentImpl` and bypass both.
  const agentRunner =
    deps.agentImpl ??
    (async (input) => {
      // TODO(task-12): startup validation in worker main.ts makes this unreachable in production.
      if (!deps.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY not configured');
      }
      const orgName = await fetchOrgName(deps.db, input.organizationId);
      const tools = await listTools({
        db: input.db,
        organizationId: input.organizationId,
        userSubjects: input.userSubjects,
      });
      logInfo('slack-bot: agent starting', {
        organizationId: input.organizationId,
        orgName,
        toolCount: tools.length,
        toolNames: tools.map((t) => t.name),
        questionPreview: input.question.slice(0, 120),
      });
      const anthropicClient = new Anthropic({ apiKey: deps.anthropicApiKey });
      const startedAt = Date.now();
      const result = await runAgent({
        db: input.db,
        organizationId: input.organizationId,
        userSubjects: input.userSubjects,
        question: input.question,
        client: anthropicClient,
        tools,
        orgName,
        wallClockMs: 180_000,
        logEvent: (event, fields) => {
          logInfo(`slack-bot: agent ${event}`, {
            organizationId: input.organizationId,
            ...fields,
          });
          if (input.progress) {
            const text = progressTextForEvent(event, fields);
            if (text) input.progress(text);
          }
        },
      });
      logInfo('slack-bot: agent finished', {
        organizationId: input.organizationId,
        durationMs: Date.now() - startedAt,
        answerLength: result.answer.length,
        sourceCount: result.sources.length,
      });
      return result;
    });

  if (job.kind === 'slash_command') {
    const trimmed = job.text.trim();
    const isPublic = trimmed.startsWith('--public ') || trimmed === '--public';
    const query = isPublic ? trimmed.replace(/^--public\s*/, '') : trimmed;
    if (!query) {
      await postSlashResponse({
        responseUrl: job.responseUrl,
        inChannel: false,
        answer: '',
        sources: [],
        fetchImpl: deps.fetchImpl,
      });
      return { ok: true };
    }
    let agentResult: AgentResult;
    try {
      agentResult = await agentRunner({
        db: deps.db,
        organizationId: workspace.organizationId,
        userSubjects,
        question: query,
      });
    } catch (err) {
      logError('slack-bot: agent failed', err);
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
      answer: agentResult.answer,
      sources: agentResult.sources,
      fetchImpl: deps.fetchImpl,
    });
    return { ok: true };
  }

  const query = cleanQuery(job.text);
  const threadTs = 'threadTs' in job ? job.threadTs : undefined;
  if (!query) {
    await client.chatPostMessage({
      channel: job.channel,
      thread_ts: threadTs,
      text: 'Ask me a question — e.g. `@holo what do we know about onboarding?`',
    });
    return { ok: true };
  }

  // Post the placeholder up front so progress updates have a target. If the
  // post itself fails (rate limit, missing scope), fall back to no-progress
  // mode — finalize* still has a chat.postMessage path.
  const placeholderResp = await client.chatPostMessage({
    channel: job.channel,
    thread_ts: threadTs,
    text: PLACEHOLDER_TEXT,
  });
  const placeholder =
    placeholderResp.ok && placeholderResp.ts && placeholderResp.channel
      ? { ts: placeholderResp.ts, channel: placeholderResp.channel }
      : null;
  const progress = placeholder
    ? makePlaceholderProgress({ client, ...placeholder }).update
    : undefined;

  let agentResult: AgentResult;
  try {
    agentResult = await agentRunner({
      db: deps.db,
      organizationId: workspace.organizationId,
      userSubjects,
      question: query,
      progress,
    });
  } catch (err) {
    logError('slack-bot: agent failed', err);
    await finalizeAgentError({ client, channel: job.channel, threadTs, placeholder });
    return { ok: true };
  }

  await finalizeAgentAnswer({
    client,
    channel: job.channel,
    threadTs,
    placeholder,
    answer: agentResult.answer,
    sources: agentResult.sources,
  });

  return { ok: true };
}
