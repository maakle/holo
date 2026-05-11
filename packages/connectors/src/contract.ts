/**
 * ConnectorRegistration — single source of truth for everything the framework
 * needs to know about a connector beyond its `ConnectorSpec` factory:
 *
 *  - provider id (must be a member of `SYNC_PROVIDERS`)
 *  - auth mode classification (drives the framework-bridge `loadTokens`
 *    short-circuit for no-auth and the OAuth callback shape requirements)
 *  - default sync interval (replaces the hand-maintained
 *    `SYNC_INTERVAL_MS_BY_PROVIDER` lookup at the call site — the map is
 *    *derived* from registrations, not duplicated)
 *  - spec factory (deferred construction, since some connectors need env)
 *
 * Why this exists
 * ---------------
 * Three recurring classes of bugs all share the same shape: the framework
 * does not make it impossible to forget a step when adding/changing a
 * connector.
 *
 *  1. No-auth connectors (`auth: none()`) must be allow-listed in the
 *     worker's `loadTokens` bridge or syncs throw HOLO_AUTH_NO_SESSION.
 *  2. Provider enumerations drift from `SYNC_PROVIDERS` — the dashboard
 *     polls a stale list, the worker subscribes to a stale list, and new
 *     connectors silently disappear into the "no new content" UI.
 *  3. Refreshable OAuth callbacks must persist `expiresAt`. Without it
 *     `shouldRefresh` returns `false` forever and the access token never
 *     rotates. GitLab is the only refreshable provider, so no sibling
 *     connector caught this bug (commit 14737ad).
 *
 * The contract makes (1) impossible by deriving the no-auth allow-list from
 * registrations; (2) impossible by deriving `SYNC_INTERVAL_MS_BY_PROVIDER`
 * (and the runtime "do I know this provider?" check) from registrations;
 * (3) impossible at the *type* level — an `oauth({ refreshable: true })`
 * registration that wants to persist tokens must go through
 * `persistRefreshableOAuthTokens`, whose input type *requires* `expiresAt`.
 *
 * Scope
 * -----
 * This is a registration contract, not a rewrite of the connector internals.
 * Per-connector diffs are intentionally thin: a registration object plus a
 * couple of imports. The framework's existing `defineConnector`, auth
 * strategies (`oauth2`, `apiKey`, `none`, `githubApp`), and runtime are
 * unchanged.
 */
import type { ConnectorSpec, ConnectorTokens } from '@holo/connector-framework';
import { ErrorCode, holoError } from '@holo/errors';
import { SYNC_PROVIDERS, type SyncProvider } from '@holo/sync-providers';

/** Auth mode classification for the framework bridge. */
export type ConnectorAuthMode =
  | { kind: 'none' }
  | { kind: 'apiKey' }
  | { kind: 'oauth'; refreshable: false }
  | { kind: 'oauth'; refreshable: true }
  | { kind: 'serviceAccount' }
  | { kind: 'githubApp' };

/**
 * Token shape returned by refreshable-OAuth callbacks. `expiresAt` is
 * *required* — that's the whole point of this branch.
 */
export interface RefreshableOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope?: string;
}

/**
 * Identity helper for OAuth callbacks of `oauth({ refreshable: true })`
 * providers. The compiler requires the caller to pass `expiresAt: Date`,
 * which is exactly the field GitLab silently omitted before commit
 * 14737ad. Returning the same object means the callback site reads
 * naturally:
 *
 *   await db.update(...).set(persistRefreshableOAuthTokens({
 *     accessToken: tokens.accessToken,
 *     refreshToken: tokens.refreshToken!,
 *     expiresAt: tokens.expiresAt!,
 *     scope: tokens.scope,
 *   }));
 *
 * A refreshable-OAuth connector that forgets `expiresAt` won't typecheck.
 */
export function persistRefreshableOAuthTokens<T extends RefreshableOAuthTokens>(tokens: T): T {
  return tokens;
}

/** Narrowing predicate — exposed for the framework bridge. */
export function isRefreshableOAuth(
  mode: ConnectorAuthMode,
): mode is { kind: 'oauth'; refreshable: true } {
  return mode.kind === 'oauth' && mode.refreshable === true;
}

/**
 * Common fields every registration has. The factory is unary so callers
 * can pass env-derived options at boot (GitHub, GitLab, Slack need
 * clientId/secret; the no-auth and personal-API-key providers ignore the
 * argument).
 */
interface BaseRegistration<TOpts> {
  /**
   * Must be a member of `SYNC_PROVIDERS`. Drives the BullMQ queue
   * subscription, the dashboard's bulk-status poll, the CLI, and the
   * framework-bridge cast in `loadTokens`.
   */
  readonly providerId: SyncProvider;
  /** Default sync cadence. The exported `SYNC_INTERVAL_MS_BY_PROVIDER` is derived from this. */
  readonly syncIntervalMs: number;
  /** Deferred spec construction — invoked once at boot per host (worker / web app). */
  createSpec(opts: TOpts): ConnectorSpec;
}

/**
 * Discriminated by `auth.kind` (and `auth.refreshable` for OAuth). The
 * refreshable-OAuth branch carries a `persistTokens` helper whose input
 * type forces `expiresAt: Date` — the compiler will not accept a token
 * row that omits it.
 */
export type ConnectorRegistration<TOpts = unknown> =
  | (BaseRegistration<TOpts> & { auth: { kind: 'none' } })
  | (BaseRegistration<TOpts> & { auth: { kind: 'apiKey' } })
  | (BaseRegistration<TOpts> & { auth: { kind: 'oauth'; refreshable: false } })
  | (BaseRegistration<TOpts> & {
      auth: { kind: 'oauth'; refreshable: true };
      persistTokens: typeof persistRefreshableOAuthTokens;
    })
  | (BaseRegistration<TOpts> & { auth: { kind: 'serviceAccount' } })
  | (BaseRegistration<TOpts> & { auth: { kind: 'githubApp' } });

/**
 * Factory that wires the type-level invariant. `defineConnectorRegistration`
 * exists so the caller can't construct a refreshable-OAuth registration
 * without going through `persistRefreshableOAuthTokens`. The function is
 * overloaded on the auth-mode branch.
 */
export function defineConnectorRegistration<TOpts>(
  reg: ConnectorRegistration<TOpts>,
): ConnectorRegistration<TOpts> {
  if (!isSyncProvider(reg.providerId)) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `ConnectorRegistration: providerId '${reg.providerId}' is not in SYNC_PROVIDERS`,
      fix: 'Add the provider id to packages/sync-providers/src/index.ts first, then register the connector.',
    });
  }
  if (reg.syncIntervalMs <= 0) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `ConnectorRegistration[${reg.providerId}]: syncIntervalMs must be > 0 (got ${reg.syncIntervalMs})`,
      fix: 'Pick a positive cadence from SYNC_INTERVAL_MS_BY_PROVIDER.',
    });
  }
  return reg;
}

function isSyncProvider(value: string): value is SyncProvider {
  return (SYNC_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Validate at module init that the array covers every SYNC_PROVIDERS member
 * exactly once. Returns a strongly-keyed lookup; throws (loudly, at boot)
 * if there's drift between the canonical provider list and the registered
 * connectors. This is the structural invariant: provider list <-> registration set.
 */
export function indexRegistrations<TOpts>(
  registrations: ReadonlyArray<ConnectorRegistration<TOpts>>,
): Readonly<Record<SyncProvider, ConnectorRegistration<TOpts>>> {
  const seen = new Map<SyncProvider, ConnectorRegistration<TOpts>>();
  for (const reg of registrations) {
    if (seen.has(reg.providerId)) {
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: `ConnectorRegistration: duplicate registration for provider '${reg.providerId}'`,
        fix: 'Each provider must have exactly one registration in CONNECTOR_REGISTRATIONS.',
      });
    }
    seen.set(reg.providerId, reg);
  }
  const missing = SYNC_PROVIDERS.filter((p) => !seen.has(p));
  if (missing.length > 0) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `ConnectorRegistration: SYNC_PROVIDERS missing registrations for: ${missing.join(', ')}`,
      fix: 'Every entry in SYNC_PROVIDERS must have a ConnectorRegistration in CONNECTOR_REGISTRATIONS.',
    });
  }
  const extra = [...seen.keys()].filter((p) => !(SYNC_PROVIDERS as readonly string[]).includes(p));
  if (extra.length > 0) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `ConnectorRegistration: registrations refer to providers not in SYNC_PROVIDERS: ${extra.join(', ')}`,
      fix: 'Add the provider id to packages/sync-providers/src/index.ts or remove the registration.',
    });
  }
  return Object.fromEntries(seen) as Record<SyncProvider, ConnectorRegistration<TOpts>>;
}

/**
 * Set of providers whose auth mode is `none`. The framework-bridge's
 * `loadTokens` reads this to short-circuit (returns an empty
 * `ConnectorTokens`) instead of querying `connector_credentials` and
 * throwing HOLO_AUTH_NO_SESSION.
 */
export function deriveNoAuthProviders<TOpts>(
  registrations: ReadonlyArray<ConnectorRegistration<TOpts>>,
): ReadonlySet<SyncProvider> {
  return new Set(registrations.filter((r) => r.auth.kind === 'none').map((r) => r.providerId));
}

/**
 * Set of providers whose auth mode is `serviceAccount`. The framework-bridge
 * routes these through the Google SA token loader instead of
 * `connector_credentials`.
 */
export function deriveServiceAccountProviders<TOpts>(
  registrations: ReadonlyArray<ConnectorRegistration<TOpts>>,
): ReadonlySet<SyncProvider> {
  return new Set(
    registrations.filter((r) => r.auth.kind === 'serviceAccount').map((r) => r.providerId),
  );
}

/**
 * Map of provider id → default sync interval (ms). Replaces the hand-
 * maintained `SYNC_INTERVAL_MS_BY_PROVIDER` map; equivalent shape so the
 * existing import surface keeps working.
 */
export function deriveSyncIntervals<TOpts>(
  registrations: ReadonlyArray<ConnectorRegistration<TOpts>>,
): Record<SyncProvider, number> {
  const out = {} as Record<SyncProvider, number>;
  for (const reg of registrations) out[reg.providerId] = reg.syncIntervalMs;
  return out;
}

/**
 * Type guard for callers that want to assert a registration is the
 * refreshable-OAuth variant before consuming `persistTokens`. Mostly used
 * by tests; production code branches on `reg.auth.kind` + `refreshable`.
 */
export function hasPersistTokens<TOpts>(
  reg: ConnectorRegistration<TOpts>,
): reg is BaseRegistration<TOpts> & {
  auth: { kind: 'oauth'; refreshable: true };
  persistTokens: typeof persistRefreshableOAuthTokens;
} {
  return isRefreshableOAuth(reg.auth);
}

// Re-export so consumers can `import { ConnectorTokens } from '@holo/connectors/contract'`.
export type { ConnectorTokens };
