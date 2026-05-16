import { randomUUID } from 'node:crypto';
import { schema, type DB } from '@holo/db';
import { createGoogleChatAppApiClient } from '@holo/connectors';
import { recordAgentEvent } from '@holo/audit';
import { type AgentResult } from '../slack-bot/agent.js';
import { loadChatWorkspaceCreds } from './workspace.js';
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
      organizationId: string;
      spaceName: string;
      threadName: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'dm';
      organizationId: string;
      spaceName: string;
      threadName?: string;
      messageName: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'reaction';
      organizationId: string;
      spaceName: string;
      messageName: string;
      asker: string;
      emoji: string;
      removed: boolean;
    }
  | {
      kind: 'unbound-info';
      domainId: string;
      askerEmail: string | null;
      spaceName: string;
      threadName?: string;
      setupUrl: string;
      useSharedServiceAccount: true;
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
    organizationId: 'organizationId' in job ? job.organizationId : undefined,
    spaceName: job.spaceName,
    asker: 'asker' in job ? job.asker : undefined,
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

  if (job.kind === 'unbound-info') {
    // No org owns this Workspace yet — the gateway couldn't match the
    // asker's email domain to any registered tenant. Post a plain reply
    // pointing them at the Holo setup page so the bot isn't silent. Uses
    // the shared SA (no org context to look up a BYO SA).
    if (!deps.sharedServiceAccountJson) {
      logError(
        'google-chat-bot: unbound-info skipped — sharedServiceAccountJson unset on worker',
      );
      return { ok: false, reason: 'shared_sa_unset' };
    }
    const client = createGoogleChatAppApiClient({
      serviceAccountJson: deps.sharedServiceAccountJson,
      fetchImpl: deps.fetchImpl,
    });
    const emailDomain = job.askerEmail?.split('@')[1] ?? null;
    const text = buildUnboundInfoText({
      emailDomain,
      setupUrl: job.setupUrl,
    });
    const res = await client.createMessage({
      parent: job.spaceName,
      body: {
        text,
        thread: job.threadName ? { name: job.threadName } : undefined,
      },
      messageReplyOption: job.threadName
        ? 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD'
        : undefined,
    });
    if (!res.ok) {
      logError(
        `google-chat-bot: unbound-info messages.create failed (parent=${job.spaceName} error=${res.error ?? 'unknown'})`,
      );
      return { ok: false, reason: 'unbound_info_post_failed' };
    }
    logInfo('google-chat-bot: unbound-info posted', {
      askerEmail: job.askerEmail,
      spaceName: job.spaceName,
    });
    return { ok: true };
  }

  const workspace = await loadChatWorkspaceCreds(
    deps.db,
    job.organizationId,
    deps.sharedServiceAccountJson,
  );
  if (!workspace) {
    logError(
      `google-chat-bot: no service account available for org ${job.organizationId} — set GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON on worker or add a BYO config`,
    );
    return { ok: false, reason: 'no_service_account' };
  }
  logInfo('google-chat-bot: workspace creds loaded', {
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
  const progressAdapter = placeholder
    ? makeChatPlaceholderProgress({ client, messageName: placeholder.messageName })
    : null;
  const progress = progressAdapter?.update;

  let agentResult: AgentResult;
  try {
    agentResult = await agentRunner({
      db: deps.db,
      organizationId: workspace.organizationId,
      userSubjects,
      question: query,
      // Progress text is built for Slack mrkdwn (underscored italics + emoji).
      // The Chat progress adapter rewrites `_..._` to `<i>...</i>` because
      // Cards v2 textParagraph parses HTML, not Slack-style underscores.
      progress,
    });
  } catch (err) {
    logError('google-chat-bot: agent failed', err);
    // Drain any pending/in-flight progress patch before the error patch so
    // a stale "reasoning…" can't land after it.
    await progressAdapter?.cancel();
    await finalizeChatError({
      client,
      spaceName: job.spaceName,
      threadName,
      placeholder,
      logError: (msg) => logError(msg),
    });
    return { ok: true };
  }

  // Drain pending/in-flight progress patches — without this, a throttled
  // setTimeout can fire *after* finalize and overwrite the answer with the
  // last progress phrase (we observed this as "answer flashed then
  // disappeared back to reasoning…").
  await progressAdapter?.cancel();

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

function buildUnboundInfoText({
  emailDomain,
  setupUrl,
}: {
  emailDomain: string | null;
  setupUrl: string;
}): string {
  const domainHint = emailDomain
    ? `Your email domain is *${emailDomain}*. Ask your admin to register it in Holo`
    : `Ask your admin to register your Workspace's email domain in Holo`;
  const setupHint = setupUrl
    ? ` at:\n${setupUrl}`
    : '.';
  return (
    `👋 Hi! This Google Workspace isn't connected to Holo yet, so I can't answer questions.\n\n` +
    `${domainHint}${setupHint}\n\n` +
    `Once registered, every user with that email domain can DM me from this Workspace.`
  );
}
