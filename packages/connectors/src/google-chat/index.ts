// Read-only ingestion connector.
export { createGoogleChatSpec, GOOGLE_CHAT_SCOPES } from './spec';
export type {
  GoogleChatSpace,
  GoogleChatMessage,
  GoogleChatUser,
  GoogleChatThread,
} from './types';

// Conversational Chat App (bot) — distinct surface, shared provider. See
// docs/designs/google-chat-app.md.
export {
  verifyGoogleChatJwt,
  __clearGoogleChatJwksCacheForTests,
} from './app-verify-jwt';
export type {
  GoogleChatVerifyResult,
  GoogleChatVerifyFailure,
  GoogleChatVerifiedClaims,
  VerifyGoogleChatJwtInput,
} from './app-verify-jwt';
export { createGoogleChatAppApiClient } from './app-api';
export type { GoogleChatAppApiClient } from './app-api';
export {
  loadChatAppAccessToken,
  __clearGoogleChatAppTokenCacheForTests,
  GOOGLE_CHAT_APP_SCOPE,
} from './app-auth';
export type {
  GoogleChatAppEvent,
  GoogleChatAppEventType,
  GoogleChatAppSpace,
  GoogleChatAppMessage,
  GoogleChatCardV2Message,
  GoogleChatCardV2,
  GoogleChatCard,
  GoogleChatCardHeader,
  GoogleChatCardSection,
  GoogleChatCardWidget,
  GoogleChatCreateMessageInput,
  GoogleChatCreateMessageResult,
  GoogleChatPatchMessageInput,
  GoogleChatPatchMessageResult,
} from './app-types';
