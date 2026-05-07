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
export { createGrainConnector } from './grain/index';
export type { GrainConnectorOptions } from './grain/index';
// Framework-native specs (new shape — no legacy Connector facade).
export { createLinearSpec } from './linear/index';
export type { LinearSpecOptions } from './linear/index';
export { createPylonSpec } from './pylon/index';
export type { PylonSpecOptions } from './pylon/index';
export { createHubspotSpec } from './hubspot/index';
export type { HubspotSpecOptions } from './hubspot/index';
export { createNotionSpec } from './notion/index';
export type { NotionSpecOptions } from './notion/index';

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
