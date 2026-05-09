// Public API
export { defineConnector, defineResource } from './define-connector';
export {
  registerSpecs,
  getSpec,
  listSpecs,
  __resetRegistryForTests,
} from './registry';

export type {
  AllowlistEntry,
  ConnectorSpec,
  ConnectorTokens,
  ResourceSpec,
  ResourceSyncContext,
  ChunkUpsert,
  ConnectorSyncSpec,
  ReportProgressFn,
  TestConnectionContext,
  TestConnectionResult,
  UiSpec,
} from './types';

// Auth strategies
export { oauth2, apiKey, githubApp, none } from './auth';
export type {
  AuthKind,
  AuthStrategy,
  BuildAuthorizeUrlInput,
  ExchangeCodeInput,
  RefreshInput,
  OAuth2Config,
  ApiKeyConfig,
  GithubAppConfig,
  GithubAppStrategy,
} from './auth';

// HTTP
export {
  createHttpClient,
  TokenBucket,
  resolveRetry,
  parseRetryAfter,
  exponentialBackoff,
  jitter,
} from './http';
export type {
  HttpClient,
  HttpConfig,
  RequestOptions,
  RateLimitConfig,
  RetryConfig,
  CreateHttpClientInput,
} from './http';

// Pagination
export { buildPaginator, parseLinkHeader } from './pagination';
export type {
  Paginator,
  CursorPaginationConfig,
  PagePaginationConfig,
  LinkHeaderPaginationConfig,
  BuildPaginatorInput,
} from './pagination';

// Webhooks
export { webhookHmac } from './webhooks';
export type {
  HmacConfig,
  WebhookSpec,
  WebhookContext,
  WebhookEnvelope,
  WebhookVerifier,
  NormalizedWebhookEvent,
} from './webhooks';

// Runtime
export { runConnectorSync } from './runtime';
export type {
  RunConnectorSyncInput,
  RuntimeStores,
  ChunkRecord,
  SyncJobInput,
  SyncJobResult,
  SyncBreakdown,
} from './runtime';
