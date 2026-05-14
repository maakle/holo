import { and, eq } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';

export interface TeamsWorkspaceCreds {
  organizationId: string;
  /** Microsoft App ID — outbound `client_credentials` client_id + inbound JWT audience. */
  appId: string;
  /** Already-decrypted client secret. Paired with appId for the token mint. */
  appSecret: string;
}

/**
 * Resolve which Holo org owns a Teams tenant + which bot credentials to
 * use for outbound posts. Two paths, mirroring slack/google-chat:
 *
 *   1. BYO path: `teamsAppConfigId` is set → the gateway already
 *      committed to a per-org bot. Read that row.
 *   2. Shared path: `teamsAppConfigId` is null → look up
 *      `teams_installations` by `tenant_id` to find the org, then use
 *      the shared bot credentials from env.
 *
 * Returns null when either lookup fails — the handler logs and skips so
 * a misconfigured tenant doesn't crash the worker. `teamsAppConfigId`
 * being non-null but stale (the row was deleted between enqueue and
 * dequeue) also returns null.
 */
export async function resolveTeamsWorkspace(
  db: DB,
  tenantId: string,
  teamsAppConfigId: string | null,
  shared: { appId: string | undefined; appSecret: string | undefined },
): Promise<TeamsWorkspaceCreds | null> {
  if (teamsAppConfigId) {
    const rows = await db
      .select({
        organizationId: schema.teamsAppConfigs.organizationId,
        appId: schema.teamsAppConfigs.appId,
        appSecret: schema.teamsAppConfigs.appSecret,
      })
      .from(schema.teamsAppConfigs)
      .where(eq(schema.teamsAppConfigs.id, teamsAppConfigId))
      .limit(1);
    if (!rows[0]) return null;
    return {
      organizationId: rows[0].organizationId,
      appId: rows[0].appId,
      appSecret: rows[0].appSecret,
    };
  }

  const installations = await db
    .select({ organizationId: schema.teamsInstallations.organizationId })
    .from(schema.teamsInstallations)
    .where(eq(schema.teamsInstallations.tenantId, tenantId))
    .limit(1);
  if (!installations[0]) return null;
  if (!shared.appId || !shared.appSecret) return null;
  return {
    organizationId: installations[0].organizationId,
    appId: shared.appId,
    appSecret: shared.appSecret,
  };
}

/**
 * Lookup the indexed bot reply for a reaction. Joins `teams_answer_index`
 * by (tenant_id, conversation_id, activity_id) — the same unique index
 * created on the answer-index table — so the reaction handler can map
 * back to the answer that received the rating.
 */
export async function lookupAnswerForReaction(
  db: DB,
  args: { tenantId: string; conversationId: string; replyToId: string },
): Promise<{
  organizationId: string;
  answerId: string;
  question: string;
  answer: string;
} | null> {
  const rows = await db
    .select({
      organizationId: schema.teamsAnswerIndex.organizationId,
      answerId: schema.teamsAnswerIndex.answerId,
      question: schema.teamsAnswerIndex.question,
      answer: schema.teamsAnswerIndex.answer,
    })
    .from(schema.teamsAnswerIndex)
    .where(
      and(
        eq(schema.teamsAnswerIndex.tenantId, args.tenantId),
        eq(schema.teamsAnswerIndex.conversationId, args.conversationId),
        eq(schema.teamsAnswerIndex.activityId, args.replyToId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
