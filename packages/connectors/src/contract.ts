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
  /** Connector-specific metadata to merge into the cursor record. Used by
   * Slack to persist `oldest_per_channel` / `bot_not_in_channel`, by GitHub
   * prose to persist per-repo cursors, etc. */
  metadataPatch?: Record<string, unknown>;
  /** Set when the sync intentionally did no work (e.g. no channels selected).
   * Distinguishes "ran and found nothing new" from "didn't have anything to
   * scan in the first place" so the UI can show a meaningful status. */
  skipReason?: string;
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
