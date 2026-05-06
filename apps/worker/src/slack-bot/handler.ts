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
  const fallback = args.answer || 'holo answered your question.';

  if (placeholder.ok && placeholder.ts && placeholder.channel) {
    await args.client.chatUpdate({
      channel: placeholder.channel,
      ts: placeholder.ts,
      text: fallback,
      blocks,
    });
    return;
  }
  // Placeholder failed (rate limit, missing scope, etc.) — try a single
  // direct post as a fallback so the user isn't left hanging.
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: fallback,
    blocks,
  });
}

/**
 * Post the standard error message via chat.update on a placeholder so we
 * don't leave a dangling "thinking..." in the channel. If the placeholder
 * post fails, fall back to a single chat.postMessage.
 */
async function postAgentErrorViaPlaceholder(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
}): Promise<void> {
  const placeholder = await args.client.chatPostMessage({
    channel: args.channel,
    text: PLACEHOLDER_TEXT,
    thread_ts: args.threadTs,
  });
  const blocks = buildErrorBlocks();
  if (placeholder.ok && placeholder.ts && placeholder.channel) {
    await args.client.chatUpdate({
      channel: placeholder.channel,
      ts: placeholder.ts,
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
  }) => Promise<AgentResult>;
  anthropicApiKey?: string;
  logError?: (message: string, err?: unknown) => void;
}

export async function handleSlackBotJob(
  job: SlackBotJob,
  deps: SlackBotHandlerDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const logError = deps.logError ?? ((msg, err) => console.error(msg, err));
  const workspace = await resolveWorkspace(deps.db, job.teamId);
  if (!workspace) {
    return { ok: false, reason: 'workspace_not_connected' };
  }

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
      const anthropicClient = new Anthropic({ apiKey: deps.anthropicApiKey });
      return runAgent({
        db: input.db,
        organizationId: input.organizationId,
        userSubjects: input.userSubjects,
        question: input.question,
        client: anthropicClient,
        tools,
        orgName,
      });
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
    await postAgentErrorViaPlaceholder({ client, channel: job.channel, threadTs });
    return { ok: true };
  }

  await postAgentAnswer({
    client,
    channel: job.channel,
    threadTs,
    answer: agentResult.answer,
    sources: agentResult.sources,
  });

  return { ok: true };
}
