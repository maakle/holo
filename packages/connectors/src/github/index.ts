// Spec (framework-native).
export { createGithubSpec } from './spec';
export type { GithubSpecOptions } from './spec';

// Auth helpers (used by the web GitHub-App install/uninstall flow + worker bridge).
export {
  loadGithubInstallationToken,
  listInstallationRepos,
  mintInstallationToken,
  mintAppJwt,
  uninstallApp,
  githubAppConfigFromEnv,
  __clearGithubAppTokenCacheForTests,
} from './auth';
export type { GithubAppConfig } from './auth';

// API client (used by chunking helpers + the github/repos web route).
export { createGithubApiClient } from './api';
export type { GithubApiClient } from './api';

// Sync engines (kept exported so the worker can wrap them via chunking.ts
// and the retrieval-core roundtrip test can drive them directly).
export { runGithubProseSync } from './sync-prose';
export type {
  RunGithubProseSyncInput,
  RunGithubProseSyncOutput,
  GithubProseChunkPayload,
  GithubProseEmbedEnqueueFn,
} from './sync-prose';
export { runGithubCodeSync, realGitShell } from './sync-code';
export type {
  RunGithubCodeSyncInput,
  RunGithubCodeSyncOutput,
  GithubCodeChunkPayload,
  GithubCodeEmbedEnqueueFn,
  GitShell,
} from './sync-code';

// Webhook (used by the web webhook receiver).
export {
  verifyGithubWebhookSignature,
  isHandledEvent,
  GITHUB_WEBHOOK_EVENTS,
} from './webhook';
export type { GithubWebhookEvent, VerifyResult } from './webhook';
