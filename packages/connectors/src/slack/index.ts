// Framework spec.
export {
  createSlackSpec,
  hasSlackBotScopes,
  SLACK_INGEST_SCOPES,
  SLACK_BOT_SCOPES,
} from './spec';
export type { SlackSpecOptions } from './spec';

// App manifest builder — used by the EE custom-Slack-app settings page.
export { buildSlackManifest } from './manifest';
export type { SlackManifestOptions } from './manifest';

// API clients (re-exported for the Slack bot, slack-personal callback, etc).
export { createSlackApiClient } from './api';
export type { SlackApiClient } from './api';
export { createSlackUserApiClient } from './user-client';
export type { SlackUserApiClient } from './user-client';

// Webhook signature verification (used by the gateway).
export {
  verifySlackSignature,
  SLACK_REPLAY_WINDOW_SECONDS,
} from './verify-signature';
export type {
  VerifySlackInput,
  VerifyResult as SlackVerifyResult,
  SlackVerifyFailure,
} from './verify-signature';

// Public Slack types (used by the bot and message-builder code).
export type {
  SlackBlock,
  SlackChannel,
  SlackMember,
  SlackMessage,
  SlackMessageMetadata,
  SlackPostMessageInput,
  SlackPostMessageResult,
} from './types';
