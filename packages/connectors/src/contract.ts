export interface ConnectorTokens {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: Date;
}

export interface BuildAuthorizeUrlInput {
  redirectUri: string;
  state: string;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface TestConnectionResult {
  ok: true;
  externalId: string;
  name: string;
  raw?: Record<string, unknown>;
}

export interface SyncContext {
  sourceId: string;
  organizationId: string;
  cursorScope: string;
  latestSeenTs?: Date;
}

export interface SyncResult {
  artifactCount: number;
  newCursor: Date | null;
}

export interface WebhookEnvelope {
  rawBody: string;
  headers: Record<string, string>;
}

export interface NormalizedWebhookEvent {
  kind: string;
  externalId: string;
  payload: Record<string, unknown>;
}

export interface Connector {
  readonly id: string;
  readonly displayName: string;

  buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<ConnectorTokens>;
  refresh(input: RefreshInput): Promise<ConnectorTokens>;
  testConnection(tokens: ConnectorTokens): Promise<TestConnectionResult>;

  fullSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult>;
  incrementalSync(tokens: ConnectorTokens, ctx: SyncContext): Promise<SyncResult>;

  verifyWebhook(env: WebhookEnvelope, secret: string): boolean;
  normalizeWebhook(env: WebhookEnvelope): NormalizedWebhookEvent;
}
