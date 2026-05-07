export * from './contract';
export * as shared from './shared/index';
export { resolveAllowlist } from './shared/allowlist';
export type { ResolveAllowlistInput, AllowlistResult, AllowlistRow } from './shared/allowlist';
export { chunkHash, dedupeAgainstDb } from './shared/content-hash';
export type { DedupeAgainstDbInput } from './shared/content-hash';
// GitHub uses GitHub App auth, not OAuth — there is no Connector facade.
// Worker dispatches directly to runGithubProseSync / runGithubCodeSync below.
// Framework-native specs (new shape — no legacy Connector facade).
export {
  createSlackSpec,
  hasSlackBotScopes,
  SLACK_INGEST_SCOPES,
  SLACK_BOT_SCOPES,
} from './slack/index';
export type { SlackSpecOptions } from './slack/index';
export { createSlackApiClient, createSlackUserApiClient } from './slack/index';
export type { SlackApiClient, SlackUserApiClient } from './slack/index';
export {
  verifySlackSignature,
  SLACK_REPLAY_WINDOW_SECONDS,
} from './slack/index';
export type {
  VerifySlackInput,
  SlackVerifyResult,
  SlackVerifyFailure,
} from './slack/index';
export type {
  SlackBlock,
  SlackChannel,
  SlackMember,
  SlackMessage,
  SlackPostMessageInput,
  SlackPostMessageResult,
} from './slack/index';
export { createLinearSpec } from './linear/index';
export type { LinearSpecOptions } from './linear/index';
export { createPylonSpec } from './pylon/index';
export type { PylonSpecOptions } from './pylon/index';
export { createHubspotSpec } from './hubspot/index';
export type { HubspotSpecOptions } from './hubspot/index';
export { createNotionSpec } from './notion/index';
export type { NotionSpecOptions } from './notion/index';
export { createGrainSpec } from './grain/index';
export type { GrainSpecOptions } from './grain/index';

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
