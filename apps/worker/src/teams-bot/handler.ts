import { randomUUID } from 'node:crypto';
import { schema, type DB } from '@holo/db';
import { createTeamsBotApiClient } from '@holo/connectors';
import { recordAgentEvent } from '@holo/audit';
import { type AgentResult } from '../slack-bot/agent.js';
import { makeDefaultAgentRunner, type AgentImpl } from '../slack-bot/agent-runner.js';
import { resolveTeamsWorkspace } from './workspace.js';
import {
  finalizeTeamsAnswer,
  finalizeTeamsError,
  postTeamsPlaceholder,
} from './finalize.js';
import { makeTeamsPlaceholderProgress } from './progress.js';

/**
 * Job kinds mirror `SlackBotJob` and `GoogleChatBotJob`. `mention` and
 * `dm` route through the same agent path; `reaction` is reserved for
 * RFC-0008 once Teams has a per-user mapping table (parallel to
 * `slack_user_credentials`).
 */
type TeamsAppConfigHint = { teamsAppConfigId: string | null };

export type TeamsBotJob =
  | ({
      kind: 'mention';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      askerName?: string;
      text: string;
    } & TeamsAppConfigHint)
  | ({
      kind: 'dm';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      askerName?: string;
      text: string;
    } & TeamsAppConfigHint)
  | ({
      kind: 'reaction';
      tenantId: string;
      activityId: string;
      conversationId: string;
      serviceUrl: string;
      asker: string;
      replyToId: string;
      reactionType: string;
      removed: boolean;
    } & TeamsAppConfigHint);

export interface TeamsBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /** Shared Holo bot App ID — env-sourced in production. BYO orgs override via teamsAppConfigId on the job. */
  sharedAppId?: string;
  /** Paired with sharedAppId for outbound token mint. */
  sharedAppSecret?: string;
  /** Override the agent loop for tests. */
  agentImpl?: AgentImpl;
  anthropicApiKey?: string;
  logError?: (message: string, err?: unknown) => void;
  logInfo?: (message: string, fields?: Record<string, unknown>) => void;
}

export async function handleTeamsBotJob(
  job: TeamsBotJob,
  deps: TeamsBotHandlerDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const logError = deps.logError ?? ((msg, err) => console.error(msg, err));
  const logInfo = deps.logInfo ?? ((msg, fields) => console.log(msg, fields ?? {}));
  logInfo('teams-bot: job received', {
    kind: job.kind,
    tenantId: job.tenantId,
    conversationId: job.conversationId,
    asker: job.asker,
    textPreview: 'text' in job ? job.text.slice(0, 80) : undefined,
  });

  if (job.kind === 'reaction') {
    // Reactions arrive in-band on the Teams webhook, but writing an
    // `answer_feedback` row requires a Teams-user → holo-user mapping
    // (analogous to `slack_user_credentials`). That mapping isn't built
    // yet; ack and log so the queue stays drained.
    logInfo('teams-bot: reaction job (user mapping pending), skipping', {
      replyToId: job.replyToId,
      reactionType: job.reactionType,
      removed: job.removed,
    });
    return { ok: false, reason: 'teams_user_mapping_not_implemented' };
  }

  const workspace = await resolveTeamsWorkspace(
    deps.db,
    job.tenantId,
    job.teamsAppConfigId,
    { appId: deps.sharedAppId, appSecret: deps.sharedAppSecret },
  );
  if (!workspace) {
    logInfo('teams-bot: workspace not connected', {
      tenantId: job.tenantId,
      teamsAppConfigId: job.teamsAppConfigId,
    });
    return { ok: false, reason: 'workspace_not_connected' };
  }
  logInfo('teams-bot: workspace resolved', {
    tenantId: job.tenantId,
    organizationId: workspace.organizationId,
  });

  const client = createTeamsBotApiClient({
    appId: workspace.appId,
    appSecret: workspace.appSecret,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });

  // Per-workspace ACL — same convention as slack/google-chat. The bot
  // answers using the org's full corpus, no per-user filtering at the
  // bot layer.
  const userSubjects = [`org:${workspace.organizationId}`];
  const traceId = randomUUID();
  const agentIdentity = `teams:${workspace.organizationId.slice(0, 8)}`;

  recordAgentEvent({
    db: deps.db,
    organizationId: workspace.organizationId,
    // Observability schema reuses 'slack_message' for all chat-bot
    // inbound — rename once analytics splits providers (tracked in the
    // google-chat-app + teams-bot specs).
    kind: 'slack_message',
    name: 'inbound',
    agentIdentity,
    traceId,
    inputJson: {
      jobKind: job.kind,
      conversationId: job.conversationId,
      asker: job.asker,
      text: job.text,
    },
    metadata: {
      tenantId: job.tenantId,
      provider: 'teams',
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
  if (!query) {
    await client.sendActivity({
      serviceUrl: job.serviceUrl,
      conversationId: job.conversationId,
      body: {
        type: 'message',
        text: 'Ask me a question — e.g. `@holo what do we know about onboarding?`',
      },
    });
    return { ok: true };
  }

  const placeholder = await postTeamsPlaceholder({
    client,
    serviceUrl: job.serviceUrl,
    conversationId: job.conversationId,
    logError: (msg) => logError(msg),
  });
  const progress = placeholder
    ? makeTeamsPlaceholderProgress({
        client,
        serviceUrl: job.serviceUrl,
        conversationId: job.conversationId,
        activityId: placeholder.activityId,
      }).update
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
    logError('teams-bot: agent failed', err);
    await finalizeTeamsError({
      client,
      serviceUrl: job.serviceUrl,
      conversationId: job.conversationId,
      placeholder,
      logError: (msg) => logError(msg),
    });
    return { ok: true };
  }

  const finalReply = await finalizeTeamsAnswer({
    client,
    serviceUrl: job.serviceUrl,
    conversationId: job.conversationId,
    placeholder,
    answer: agentResult.answer,
    sources: agentResult.sources,
    logError: (msg) => logError(msg),
  });

  // RFC-0008 anchor: index the bot reply so a future reaction can be
  // turned into a feedback row. Best-effort — if the Bot Connector
  // didn't return an activity id, skip silently. Mirrors the
  // slack/google-chat handlers' conflict policy.
  if (finalReply?.activityId) {
    try {
      await deps.db
        .insert(schema.teamsAnswerIndex)
        .values({
          organizationId: workspace.organizationId,
          answerId: agentResult.answerId,
          tenantId: job.tenantId,
          conversationId: job.conversationId,
          activityId: finalReply.activityId,
          serviceUrl: job.serviceUrl,
          question: query,
          answer: agentResult.answer,
          sourcesJsonb: agentResult.sources,
        })
        .onConflictDoNothing({
          target: schema.teamsAnswerIndex.answerId,
        });
    } catch (err) {
      logError('teams-bot: teams_answer_index insert failed', err);
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
      conversationId: job.conversationId,
      answerId: agentResult.answerId,
      provider: 'teams',
    },
  });

  return { ok: true };
}
