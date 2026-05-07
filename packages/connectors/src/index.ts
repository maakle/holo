export * from './contract';
export * as shared from './shared/index';
export { resolveAllowlist } from './shared/allowlist';
export type { ResolveAllowlistInput, AllowlistResult, AllowlistRow } from './shared/allowlist';
export { chunkHash, dedupeAgainstDb } from './shared/content-hash';
export type { DedupeAgainstDbInput } from './shared/content-hash';
// GitHub uses GitHub App auth, not OAuth — there is no Connector facade.
// Worker dispatches directly to runGithubProseSync / runGithubCodeSync below.
export {
  createSlackConnector,
  hasSlackBotScopes,
  SLACK_INGEST_SCOPES,
  SLACK_BOT_SCOPES,
} from './slack/index';
export type { SlackConnectorOptions } from './slack/index';
export { createSlackUserApiClient } from './slack/user-client';
export type { SlackUserApiClient } from './slack/user-client';
export { createSlackApiClient } from './slack/api-client';
export {
  verifySlackSignature,
  SLACK_REPLAY_WINDOW_SECONDS,
} from './slack/verify-signature';
export type {
  VerifySlackInput,
  VerifyResult as SlackVerifyResult,
  SlackVerifyFailure,
} from './slack/verify-signature';
export type {
  SlackApiClient,
  SlackBlock,
  SlackPostMessageInput,
  SlackPostMessageResult,
} from './slack/api-client';
export { createNotionConnector } from './notion/index';
export type { NotionConnectorOptions } from './notion/index';
export { createGrainConnector } from './grain/index';
export type { GrainConnectorOptions } from './grain/index';
export { createHubspotConnector } from './hubspot/index';
export type { HubspotConnectorOptions } from './hubspot/index';
// Framework-native specs (new shape — no legacy Connector facade).
export { createLinearSpec } from './linear/index';
export type { LinearSpecOptions } from './linear/index';
export { createPylonSpec } from './pylon/index';
export type { PylonSpecOptions } from './pylon/index';
export { runHubspotSync } from './hubspot/sync';
export type {
  RunHubspotSyncInput,
  RunHubspotSyncOutput,
  HubspotChunkPayload,
  HubspotChunkKind,
  HubspotEmbedEnqueueFn,
  HubspotCursor,
} from './hubspot/sync';
export { createHubspotApiClient } from './hubspot/api-client';
export type {
  HubspotApiClient,
  HubspotRecord,
  HubspotEngagement,
  HubspotObjectType,
  HubspotListPage,
} from './hubspot/api-client';

// Underlying sync engines + API clients (used by the worker to bypass the
// connector facade for github, where prose and code dispatch on different queues).
export { runGithubProseSync } from './github/sync-prose';
export type {
  RunGithubProseSyncInput,
  RunGithubProseSyncOutput,
  GithubProseChunkPayload,
  GithubProseEmbedEnqueueFn,
} from './github/sync-prose';
export { runGithubCodeSync, realGitShell } from './github/sync-code';
export type {
  RunGithubCodeSyncInput,
  RunGithubCodeSyncOutput,
  GithubCodeChunkPayload,
  GithubCodeEmbedEnqueueFn,
  GitShell,
} from './github/sync-code';
export { createGithubApiClient } from './github/api-client';
export type { GithubApiClient } from './github/api-client';
export {
  loadGithubInstallationToken,
  listInstallationRepos,
  mintInstallationToken,
  mintAppJwt,
  uninstallApp,
  githubAppConfigFromEnv,
  __clearGithubAppTokenCacheForTests,
} from './github/auth';
export type { GithubAppConfig } from './github/auth';
export {
  verifyGithubWebhookSignature,
  isHandledEvent,
  GITHUB_WEBHOOK_EVENTS,
} from './github/webhook';
export type { GithubWebhookEvent, VerifyResult } from './github/webhook';
