import { randomUUID } from 'node:crypto';
import { schema, type DB } from '@holo/db';
import { createGoogleChatAppApiClient } from '@holo/connectors';
import { recordAgentEvent } from '@holo/audit';
import { type AgentResult } from '../slack-bot/agent.js';
import { resolveChatWorkspace } from './workspace.js';
import { makeDefaultAgentRunner, type AgentImpl } from '../slack-bot/agent-runner.js';
import { finalizeChatAnswer, finalizeChatError, postPlaceholder } from './finalize.js';
import { makeChatPlaceholderProgress } from './progress.js';

/**
 * Job kinds mirror `SlackBotJob`. `mention` and `dm` route through the
 * same agent path; `reaction` is reserved for the post-launch RFC-0008
 * feedback subscription.
 */
export type GoogleChatBotJob =
  | {
      kind: 'mention';
      customerNumber: string;
      spaceName: string;
      threadName: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'dm';
      customerNumber: string;
      spaceName: string;
      threadName?: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'reaction';
      customerNumber: string;
      spaceName: string;
      messageName: string;
      asker: string;
      emoji: string;
      removed: boolean;
    };

export interface GoogleChatBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /**
   * Service account JSON for the shared Holo Chat App, sourced from env in
   * production. Workspaces with a BYO app row override this.
   */
  sharedServiceAccountJson?: string;
  /**
   * Override the agent loop for tests. Re-uses the Slack bot's
   * `AgentImpl` type — the agent contract is provider-agnostic.
   */
  agentImpl?: AgentImpl;
  anthropicApiKey?: string;
  logError?: (message: string, err?: unknown) => void;
  logInfo?: (message: string, fields?: Record<string, unknown>) => void;
}

export async function handleGoogleChatBotJob(
  job: GoogleChatBotJob,
  deps: GoogleChatBotHandlerDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const logError = deps.logError ?? ((msg, err) => console.error(msg, err));
  const logInfo = deps.logInfo ?? ((msg, fields) => console.log(msg, fields ?? {}));
  logInfo('google-chat-bot: job received', {
    kind: job.kind,
    customerNumber: job.customerNumber,
    spaceName: job.spaceName,
    asker: job.asker,
    textPreview: 'text' in job ? job.text.slice(0, 80) : undefined,
  });

  if (job.kind === 'reaction') {
    // Reactions land post-launch; ack and log so the queue stays drained
    // if the gateway is ever ahead of the worker.
    logInfo('google-chat-bot: reaction job (not yet implemented), skipping', {
      messageName: job.messageName,
      emoji: job.emoji,
    });
    return { ok: false, reason: 'reactions_not_implemented' };
  }

  const workspace = await resolveChatWorkspace(
    deps.db,
    job.customerNumber,
    deps.sharedServiceAccountJson,
  );
  if (!workspace) {
    logInfo('google-chat-bot: workspace not connected', {
      customerNumber: job.customerNumber,
    });
    return { ok: false, reason: 'workspace_not_connected' };
  }
  logInfo('google-chat-bot: workspace resolved', {
    customerNumber: job.customerNumber,
    organizationId: workspace.organizationId,
  });

  const client = createGoogleChatAppApiClient({
    serviceAccountJson: workspace.serviceAccountJson,
    fetchImpl: deps.fetchImpl,
  });

  // Per-workspace ACL — the bot answers using the workspace's full corpus.
  // Same convention as the Slack bot (`org:<id>`), confirmed product
  // decision; no per-user filtering at the bot layer.
  const userSubjects = [`org:${workspace.organizationId}`];

  const traceId = randomUUID();
  const agentIdentity = `google-chat:${workspace.organizationId.slice(0, 8)}`;

  recordAgentEvent({
    db: deps.db,
    organizationId: workspace.organizationId,
    kind: 'slack_message', // observability schema reuses 'slack_message' for chat-bot inbound; rename once analytics splits providers.
    name: 'inbound',
    agentIdentity,
    traceId,
    inputJson: {
      jobKind: job.kind,
      spaceName: job.spaceName,
      asker: job.asker,
      text: job.text,
    },
    metadata: {
      customerNumber: job.customerNumber,
      threadName: 'threadName' in job ? job.threadName : undefined,
      provider: 'google-chat',
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

  const query = job.text.trim();
  const threadName = 'threadName' in job ? job.threadName : undefined;

  if (!query) {
    await client.createMessage({
      parent: job.spaceName,
      body: {
        text: 'Ask me a question — e.g. `@holo what do we know about onboarding?`',
        thread: threadName ? { name: threadName } : undefined,
      },
      messageReplyOption: threadName
        ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
        : undefined,
    });
    return { ok: true };
  }

  const placeholder = await postPlaceholder({
    client,
    spaceName: job.spaceName,
    threadName,
    logError: (msg) => logError(msg),
  });
  const progress = placeholder
    ? makeChatPlaceholderProgress({ client, messageName: placeholder.messageName })
        .update
    : undefined;

  let agentResult: AgentResult;
  try {
    agentResult = await agentRunner({
      db: deps.db,
      organizationId: workspace.organizationId,
      userSubjects,
      question: query,
      // Progress text is built for Slack mrkdwn (underscored italics + emoji).
      // Cards v2 renders italics via underscores the same way, so we pass it
      // through unmodified.
      progress,
    });
  } catch (err) {
    logError('google-chat-bot: agent failed', err);
    await finalizeChatError({
      client,
      spaceName: job.spaceName,
      threadName,
      placeholder,
      logError: (msg) => logError(msg),
    });
    return { ok: true };
  }

  const finalReply = await finalizeChatAnswer({
    client,
    spaceName: job.spaceName,
    threadName,
    placeholder,
    answer: agentResult.answer,
    sources: agentResult.sources,
    logError: (msg) => logError(msg),
  });

  // RFC-0008 anchor: index the bot reply so a future reaction can be
  // turned into a feedback row. Best-effort — if the Chat API call didn't
  // return a name, skip silently (feedback for this turn would be
  // unattributable). Mirror the Slack handler's conflict policy.
  if (finalReply?.messageName) {
    try {
      await deps.db
        .insert(schema.googleChatAnswerIndex)
        .values({
          organizationId: workspace.organizationId,
          answerId: agentResult.answerId,
          spaceName: job.spaceName,
          messageName: finalReply.messageName,
          question: query,
          answer: agentResult.answer,
          sourcesJsonb: agentResult.sources,
        })
        .onConflictDoNothing({
          target: schema.googleChatAnswerIndex.answerId,
        });
    } catch (err) {
      logError('google-chat-bot: google_chat_answer_index insert failed', err);
    }
  }

  recordAgentEvent({
    db: deps.db,
    organizationId: workspace.organizationId,
    kind: 'slack_message',
    name: 'outbound',
    agentIdentity,
    traceId,
    outputJson: { answer: agentResult.answer, sources: agentResult.sources },
    metadata: {
      jobKind: job.kind,
      spaceName: job.spaceName,
      threadName,
      answerId: agentResult.answerId,
      provider: 'google-chat',
    },
  });

  return { ok: true };
}
