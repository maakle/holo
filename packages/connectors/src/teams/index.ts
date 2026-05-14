/**
 * Microsoft Teams Bot integration — outbound API client + inbound JWT
 * verification + wire-format types. This is the bot/conversational
 * surface only; a read-only ingestion sibling can be added later without
 * filename collision (same pattern as `google-chat/app-*.ts`).
 */
export {
  createTeamsBotApiClient,
  type TeamsBotApiClient,
} from './app-api';
export {
  loadTeamsBotAccessToken,
  TEAMS_BOT_SCOPE,
  __clearTeamsBotTokenCacheForTests,
} from './app-auth';
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
