export * from './contract';
export * as shared from './shared/index';
export { resolveAllowlist } from './shared/allowlist';
export type { ResolveAllowlistInput, AllowlistResult, AllowlistRow } from './shared/allowlist';
export { chunkHash, dedupeAgainstDb } from './shared/content-hash';
export type { DedupeAgainstDbInput } from './shared/content-hash';
export { createGithubConnector } from './github/index';
export type { GithubConnectorOptions } from './github/index';
export { createSlackConnector } from './slack/index';
export type { SlackConnectorOptions } from './slack/index';
export { createSlackUserApiClient } from './slack/user-client';
export type { SlackUserApiClient } from './slack/user-client';
export { createNotionConnector } from './notion/index';
export type { NotionConnectorOptions } from './notion/index';
export { createGrainConnector } from './grain/index';
export type { GrainConnectorOptions } from './grain/index';
export { createPylonConnector } from './pylon/index';
export type { PylonConnectorOptions } from './pylon/index';
export { createHubspotConnector } from './hubspot/index';
export type { HubspotConnectorOptions } from './hubspot/index';
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
