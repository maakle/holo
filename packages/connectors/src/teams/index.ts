/**
 * Microsoft Teams integration.
 *
 * Two surfaces share this folder and the same Azure AD app registration:
 *   - bot/conversational  → `app-*.ts` (outbound Bot Framework client,
 *                            inbound JWT verification, Adaptive Card
 *                            wire types)
 *   - read-only ingestion → `graph-*.ts` (Microsoft Graph client +
 *                            response types; consumed by
 *                            `packages/connectors/src/teams/spec.ts`
 *                            and the worker sync runners)
 *
 * The two surfaces overlap only at the token mint
 * (`loadTeamsBotAccessToken`), which is parameterized over scope +
 * tenant so the bot path stays on `api.botframework.com/.default` and
 * the ingestion path mints `graph.microsoft.com/.default` per
 * customer tenant.
 */
export {
  createTeamsBotApiClient,
  type TeamsBotApiClient,
} from './app-api';
export {
  loadTeamsBotAccessToken,
  TEAMS_BOT_SCOPE,
  TEAMS_GRAPH_SCOPE,
  __clearTeamsBotTokenCacheForTests,
} from './app-auth';
export {
  createTeamsGraphClient,
  type TeamsGraphClient,
  type TeamsGraphClientOptions,
  type GraphChannelMessagesPage,
} from './graph-api';
export {
  createTeamsSpec,
  type TeamsSpecOptions,
} from './spec';
export {
  runTenantSync,
  groupThreads,
  parseStoredCursor,
  loadResourceMembers,
  type TeamsCursor,
  type ResourceCursor,
  type EmittedThread,
  type EmittedDeletion,
  type ResourceEmission,
  type TenantSyncResult,
  type GroupedThread,
  type EmitFn,
} from './sync';
export type {
  GraphCollection,
  GraphOrganization,
  GraphTeam,
  GraphChannel,
  GraphChat,
  GraphChatMessage,
  GraphUser,
  GraphConversationMember,
} from './graph-types';
export {
  verifyTeamsJwt,
  __clearTeamsJwksCacheForTests,
  type VerifyTeamsJwtInput,
  type TeamsVerifyResult,
  type TeamsVerifyFailure,
  type TeamsVerifiedClaims,
} from './app-verify-jwt';
export type {
  TeamsActivity,
  TeamsActivityType,
  TeamsConversation,
  TeamsChannelAccount,
  TeamsEntity,
  TeamsChannelData,
  TeamsMessageReaction,
  AdaptiveCardV14,
  AdaptiveCardElement,
  AdaptiveCardAction,
  TeamsOutboundActivity,
  TeamsAttachment,
  TeamsSendActivityInput,
  TeamsSendActivityResult,
  TeamsUpdateActivityInput,
  TeamsUpdateActivityResult,
} from './app-types';
