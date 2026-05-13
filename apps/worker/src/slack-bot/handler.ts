import { randomUUID } from 'node:crypto';
import { schema, type DB } from '@holo/db';
import { createSlackApiClient } from '@holo/connectors';
import { recordAgentEvent } from '@holo/audit';
import { type AgentResult } from './agent.js';
import { ERROR_FALLBACK_TEXT } from './blocks.js';
import { resolveWorkspace } from './workspace.js';
import { PLACEHOLDER_TEXT, cleanQuery } from './agent-events.js';
import { makePlaceholderProgress } from './progress.js';
import {
  finalizeAgentAnswer,
  finalizeAgentError,
  postSlashResponse,
} from './finalize.js';
import { makeDefaultAgentRunner, type AgentImpl } from './agent-runner.js';
import { handleFeedbackReaction } from './feedback-reaction.js';

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
    }
  | {
      // RFC-0008 (slack extension). A reaction landed on a bot message that
      // was previously indexed in `slack_answer_index`; emoji shorthand
      // becomes a feedback row. `removed=true` means a reaction was taken
      // back — we mirror that as a delete.
      kind: 'reaction_added';
      teamId: string;
      channel: string;
      messageTs: string;
      asker: string;
      reaction: string;
      removed: boolean;
    };

export interface SlackBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /**
   * Override the agent loop for tests. In production, `makeDefaultAgentRunner`
   * lazily creates an Anthropic client and calls listTools + runAgent.
   * Injecting this avoids touching either, which keeps tests light.
   */
  agentImpl?: AgentImpl;
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
    textPreview: 'text' in job ? job.text.slice(0, 80) : undefined,
    reaction: job.kind === 'reaction_added' ? job.reaction : undefined,
  });

  // RFC-0008 (slack extension): reactions don't need a slack API client or
  // the agent loop — they just need DB access to look up the indexed answer
  // and write a feedback row. Short-circuit before workspace resolution so
  // the path stays cheap even for high-traffic emoji.
  if (job.kind === 'reaction_added') {
    return handleFeedbackReaction(job, deps.db, logInfo);
  }

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

  // Trace id groups every event from this Slack interaction (inbound message,
  // every model_call, every tool_call, the outbound answer). The
  // observability UI uses this to collapse one Slack thread reply into a
  // single expandable row.
  const traceId = randomUUID();
  const agentIdentity = `slack:${workspace.organizationId.slice(0, 8)}`;

  recordAgentEvent({
    db: deps.db,
    organizationId: workspace.organizationId,
    kind: 'slack_message',
    name: 'inbound',
    agentIdentity,
    traceId,
    inputJson: {
      jobKind: job.kind,
      channel: job.channel,
      asker: job.asker,
      text: job.text,
    },
    metadata: {
      teamId: job.teamId,
      threadTs: 'threadTs' in job ? job.threadTs : undefined,
    },
  });

  const agentRunner =
    deps.agentImpl ??
    makeDefaultAgentRunner({
      db: deps.db,
      anthropicApiKey: deps.anthropicApiKey,
      traceId,
      agentIdentity,
      logInfo,
    });

  if (job.kind === 'slash_command') {
    return runSlashCommand({
      job,
      organizationId: workspace.organizationId,
      userSubjects,
      agentRunner,
      agentIdentity,
      traceId,
      deps,
      logError,
    });
  }

  return runMention({
    job,
    client,
    organizationId: workspace.organizationId,
    userSubjects,
    agentRunner,
    agentIdentity,
    traceId,
    deps,
    logError,
  });
}

async function runSlashCommand(args: {
  job: Extract<SlackBotJob, { kind: 'slash_command' }>;
  organizationId: string;
  userSubjects: string[];
  agentRunner: AgentImpl;
  agentIdentity: string;
  traceId: string;
  deps: SlackBotHandlerDeps;
  logError: (message: string, err?: unknown) => void;
}): Promise<{ ok: true }> {
  const { job, organizationId, userSubjects, agentRunner, agentIdentity, traceId, deps, logError } =
    args;
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
      organizationId,
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
  recordAgentEvent({
    db: deps.db,
    organizationId,
    kind: 'slack_message',
    name: 'outbound',
    agentIdentity,
    traceId,
    outputJson: { answer: agentResult.answer, sources: agentResult.sources },
    metadata: { jobKind: 'slash_command', inChannel: isPublic },
  });
  return { ok: true };
}

async function runMention(args: {
  job: Extract<SlackBotJob, { kind: 'app_mention' | 'message_im' }>;
  client: ReturnType<typeof createSlackApiClient>;
  organizationId: string;
  userSubjects: string[];
  agentRunner: AgentImpl;
  agentIdentity: string;
  traceId: string;
  deps: SlackBotHandlerDeps;
  logError: (message: string, err?: unknown) => void;
}): Promise<{ ok: true }> {
  const { job, client, organizationId, userSubjects, agentRunner, agentIdentity, traceId, deps, logError } =
    args;
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
      organizationId,
      userSubjects,
      question: query,
      progress,
    });
  } catch (err) {
    logError('slack-bot: agent failed', err);
    await finalizeAgentError({ client, channel: job.channel, threadTs, placeholder });
    return { ok: true };
  }

  const finalReply = await finalizeAgentAnswer({
    client,
    channel: job.channel,
    threadTs,
    placeholder,
    answer: agentResult.answer,
    sources: agentResult.sources,
  });

  // RFC-0008 (slack extension): index the bot reply so a future reaction
  // can be turned into a feedback row. Best-effort — if the slack API call
  // didn't return a ts (rate limit, scope), the index row would have no
  // anchor and would be unmatchable; skip silently.
  if (finalReply?.ts && finalReply?.channel) {
    try {
      await deps.db
        .insert(schema.slackAnswerIndex)
        .values({
          organizationId,
          answerId: agentResult.answerId,
          slackTeamId: job.teamId,
          slackChannel: finalReply.channel,
          slackTs: finalReply.ts,
          question: query,
          answer: agentResult.answer,
          sourcesJsonb: agentResult.sources,
        })
        .onConflictDoNothing({ target: schema.slackAnswerIndex.answerId });
    } catch (err) {
      // Persistence failure can't be allowed to kill the slack reply UX.
      // Log and move on — feedback for this turn will just be unattributable.
      logError('slack-bot: slack_answer_index insert failed', err);
    }
  }

  recordAgentEvent({
    db: deps.db,
    organizationId,
    kind: 'slack_message',
    name: 'outbound',
    agentIdentity,
    traceId,
    outputJson: { answer: agentResult.answer, sources: agentResult.sources },
    metadata: {
      jobKind: job.kind,
      channel: job.channel,
      threadTs,
      answerId: agentResult.answerId,
    },
  });

  return { ok: true };
}
