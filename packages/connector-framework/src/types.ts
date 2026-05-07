import type { ZodType } from 'zod';
import type { AuthStrategy } from './auth/types';
import type { HttpClient, HttpConfig } from './http/types';
import type { Paginator } from './pagination/types';
import type { WebhookSpec } from './webhooks/types';

export interface ConnectorTokens {
  accessToken: string;
  refreshToken?: string;
  scope?: string;
  expiresAt?: Date;
}

export interface TestConnectionResult {
  externalId: string;
  name: string;
  raw?: Record<string, unknown>;
}

export interface TestConnectionContext {
  tokens: ConnectorTokens;
  api: HttpClient;
}

export interface ChunkUpsert {
  externalId: string;
  kind: string;
  content: string;
  metadata: Record<string, unknown>;
  aclSubjects: string[];
  /**
   * Override the synthetic source-artifact id. By default the runtime uses
   * `${kind}:${externalId}`, which is right when one record = one chunk kind.
   * Connectors that group multiple chunk kinds under the *same* parent
   * record (e.g. a HubSpot contact and its engagement timeline both belong
   * to `hubspot-contact:<id>`) supply this so all chunks share one
   * `source_artifacts` row.
   */
  sourceArtifactId?: string;
}

export type ReportProgressFn = (input: {
  current: number;
  total?: number | null;
  message?: string;
}) => void;

/**
 * One row in the host's allowlist table for a given (org, provider).
 * Decisions are 'include' / 'exclude'; pattern kinds are 'glob' / 'exact_id'.
 * Specs that need narrowing (Slack channels, GitHub repos, Notion pages)
 * read these from `ctx.allowlist` and decide policy themselves — the
 * framework doesn't impose matching semantics.
 */
export interface AllowlistEntry {
  pattern: string;
  patternKind: 'glob' | 'exact_id';
  decision: 'include' | 'exclude';
}

export interface ResourceSyncContext<TCursor> {
  readonly organizationId: string;
  readonly sourceId: string;
  readonly tokens: ConnectorTokens;
  readonly api: HttpClient;
  readonly paginate: Paginator;
  readonly cursor: TCursor;
  /**
   * Allowlist rows for this (organization, provider). Empty array if the
   * host doesn't expose one or has no entries; specs that require an
   * allowlist (e.g. Slack, Notion) should throw HOLO_ALLOWLIST_EMPTY in
   * that case so operators see a clear setup error.
   */
  readonly allowlist: ReadonlyArray<AllowlistEntry>;
  /**
   * The host's `sources.metadata` JSONB for this source. Specs that key
   * per-source state on the source row itself (e.g. Mintlify stores its
   * docs `baseUrl` here) read it via this field. Empty object when the
   * host doesn't populate metadata or `loadSourceMetadata` isn't wired.
   */
  readonly sourceMetadata: Record<string, unknown>;
  upsert(chunk: ChunkUpsert): Promise<void>;
  flushCursor(cursor: TCursor): Promise<void>;
  reportProgress?: ReportProgressFn;
  readonly signal?: AbortSignal;
}

export interface ResourceSpec<TCursor = unknown> {
  /** Unique within the spec; doubles as the cursor `scope` value. */
  readonly id: string;
  readonly displayName?: string;
  /** Zod schema with a `.default()` so first-run cursors are valid. */
  readonly cursorSchema: ZodType<TCursor>;
  sync(ctx: ResourceSyncContext<TCursor>): Promise<TCursor>;
}

export interface UiSpec {
  description?: string;
  category?: 'communication' | 'docs' | 'crm' | 'support' | 'meetings' | 'vcs' | 'project' | 'other';
  /**
   * Names of extra wizard steps the spec contributes (e.g. 'channels' for
   * Slack, 'repos' for GitHub). The web app maps these names to step
   * components — the framework only declares that they exist so the wizard
   * generator knows where to insert them.
   */
  extraWizardSteps?: ReadonlyArray<{
    id: string;
    label: string;
    /** 'before-first-sync' (default) | 'after-install' */
    position?: 'before-first-sync' | 'after-install';
  }>;
}

export interface ConnectorSpec {
  readonly id: string;
  readonly displayName: string;

  readonly auth: AuthStrategy;
  readonly http?: HttpConfig;

  testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult>;

  readonly resources: ReadonlyArray<ResourceSpec<unknown>>;

  readonly webhooks?: WebhookSpec;
  readonly ui?: UiSpec;
}
