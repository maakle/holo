export * as shared from './shared/index';
export {
  SYNC_INTERVAL_MS_BY_PROVIDER,
  getSyncIntervalMs,
} from './sync-intervals';
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
export {
  createGoogleDriveSpec,
  GOOGLEDRIVE_FILE_KIND,
  buildIncrementalListQuery as buildGoogleDriveListQuery,
} from './googledrive/index';
export type {
  GoogleDriveSpecOptions,
  DriveAbout,
  DriveFile,
  DriveFilesPage,
  SharedDrive,
} from './googledrive/index';
export {
  createGitlabSpec,
  createGitlabApiClient,
  listAccessibleProjects as listGitlabAccessibleProjects,
  runGitlabProseSync,
  runGitlabCodeSync,
} from './gitlab/index';
export type {
  GitlabSpecOptions,
  GitlabApiClient,
  GitlabUser,
  GitlabProject,
  GitlabMergeRequest,
  GitlabIssue,
  GitlabNote,
  GitlabRepoTreeEntry,
  GitlabBranch,
  RunGitlabProseSyncInput,
  RunGitlabProseSyncOutput,
  GitlabProseChunkPayload,
  GitlabProseEmbedEnqueueFn,
  RunGitlabCodeSyncInput,
  RunGitlabCodeSyncOutput,
  GitlabCodeChunkPayload,
  GitlabCodeEmbedEnqueueFn,
} from './gitlab/index';
export { createPylonSpec } from './pylon/index';
export type { PylonSpecOptions } from './pylon/index';
export { createHubspotSpec } from './hubspot/index';
export type { HubspotSpecOptions } from './hubspot/index';
export { createNotionSpec } from './notion/index';
export type { NotionSpecOptions } from './notion/index';
export { createAirtableSpec } from './airtable/index';
export type {
  AirtableSpecOptions,
  AirtableBase,
  AirtableField,
  AirtableRecord,
  AirtableTable,
  AirtableUserMe,
} from './airtable/index';
export { createGrainSpec } from './grain/index';
export type { GrainSpecOptions } from './grain/index';
export { createGoogleChatSpec, GOOGLE_CHAT_SCOPES } from './google-chat/index';
export type {
  GoogleChatSpecOptions,
  GoogleChatSpace,
  GoogleChatMessage,
  GoogleChatUser,
  GoogleChatThread,
} from './google-chat/index';
export {
  createMintlifySpec,
  fetchLlmsIndex,
  parseLlmsIndex,
  fetchPageMarkdown,
  probeOpenApi,
  normalizeBaseUrl,
} from './mintlify/index';
export type {
  MintlifySpecOptions,
  LlmsIndex,
  LlmsIndexEntry,
} from './mintlify/index';
export {
  createZendeskSpec,
  iterateArticlesIncremental,
  fetchAllSections as fetchAllZendeskSections,
  fetchAllCategories as fetchAllZendeskCategories,
} from './zendesk/index';
export type {
  ZendeskSpecOptions,
  ZendeskArticle,
  ZendeskSection,
  ZendeskCategory,
  ZendeskArticlesPage,
} from './zendesk/index';

// GitHub (framework-native spec + retained helpers for the bot, gateway,
// install/uninstall flow, and the webhook receiver). All re-exported via
// github/index.ts so the public surface follows the canonical template.
export {
  createGithubSpec,
  loadGithubInstallationToken,
  listInstallationRepos,
  mintInstallationToken,
  mintAppJwt,
  uninstallApp,
  githubAppConfigFromEnv,
  __clearGithubAppTokenCacheForTests,
  createGithubApiClient,
  runGithubProseSync,
  runGithubCodeSync,
  realGitShell,
  verifyGithubWebhookSignature,
  isHandledEvent,
  GITHUB_WEBHOOK_EVENTS,
} from './github/index';
export type {
  GithubSpecOptions,
  GithubAppConfig,
  GithubApiClient,
  RunGithubProseSyncInput,
  RunGithubProseSyncOutput,
  GithubProseChunkPayload,
  GithubProseEmbedEnqueueFn,
  RunGithubCodeSyncInput,
  RunGithubCodeSyncOutput,
  GithubCodeChunkPayload,
  GithubCodeEmbedEnqueueFn,
  GitShell,
  GithubWebhookEvent,
  VerifyResult,
} from './github/index';
