/**
 * Contract invariants. These are the structural guarantees the
 * ConnectorRegistration contract exists to enforce; if any of these fail
 * a developer has reintroduced one of the three latent-bug classes the
 * contract was designed to prevent.
 *
 * The whole point: adding a new connector is one registration object,
 * and the framework — bridge, sync-intervals map, refreshable-OAuth
 * callbacks — derives every downstream behavior from it.
 */
import { describe, it, expect } from 'vitest';
import { SYNC_PROVIDERS, type SyncProvider } from '@holo/sync-providers';
import {
  CONNECTOR_REGISTRATIONS,
  CONNECTOR_REGISTRATIONS_BY_PROVIDER,
  SYNC_INTERVAL_MS_BY_PROVIDER,
  defineConnectorRegistration,
  deriveNoAuthProviders,
  deriveServiceAccountProviders,
  deriveSyncIntervals,
  hasPersistTokens,
  indexRegistrations,
  isRefreshableOAuth,
  persistRefreshableOAuthTokens,
  type ConnectorRegistration,
} from '../src';

describe('ConnectorRegistration contract', () => {
  it('covers every SYNC_PROVIDERS entry exactly once', () => {
    const ids = CONNECTOR_REGISTRATIONS.map((r) => r.providerId).sort();
    const expected = [...SYNC_PROVIDERS].sort();
    expect(ids).toEqual(expected);
  });

  it('exposes a strongly-keyed lookup', () => {
    for (const provider of SYNC_PROVIDERS) {
      const reg = CONNECTOR_REGISTRATIONS_BY_PROVIDER[provider];
      expect(reg).toBeDefined();
      expect(reg.providerId).toBe(provider);
    }
  });

  it('every registration syncIntervalMs matches SYNC_INTERVAL_MS_BY_PROVIDER', () => {
    // The runtime invariant for the lockstep claim in sync-intervals.ts.
    // Editing one without the other should fail this test.
    for (const reg of CONNECTOR_REGISTRATIONS) {
      expect(reg.syncIntervalMs).toBe(SYNC_INTERVAL_MS_BY_PROVIDER[reg.providerId]);
    }
  });

  it('every refreshable-OAuth registration carries persistTokens', () => {
    // The class of bug GitLab silently bit (commit 14737ad): a refreshable
    // OAuth provider whose callback doesn't persist expiresAt makes
    // shouldRefresh return false forever. The contract forces every
    // refreshable-OAuth registration to expose `persistTokens`, whose
    // input type requires `expiresAt: Date`.
    for (const reg of CONNECTOR_REGISTRATIONS) {
      if (isRefreshableOAuth(reg.auth)) {
        expect(hasPersistTokens(reg)).toBe(true);
        // The helper is a specific reference — registration must use the
        // canonical export, not a copy that drops the type constraint.
        expect((reg as { persistTokens: unknown }).persistTokens).toBe(
          persistRefreshableOAuthTokens,
        );
      }
    }
  });

  it('persistRefreshableOAuthTokens enforces expiresAt at the type level', () => {
    // Compile-time guarantee, but spot-check the runtime identity too.
    const expiresAt = new Date();
    const out = persistRefreshableOAuthTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt,
      scope: 's',
    });
    expect(out).toEqual({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt,
      scope: 's',
    });

    // This block won't compile if we ever drop the `expiresAt: Date` field
    // from `RefreshableOAuthTokens` — encoded here as a comment so future
    // readers see the intent. (TypeScript's structural typing catches it
    // before vitest ever runs.)
    //
    //   persistRefreshableOAuthTokens({
    //     accessToken: 'a',
    //     refreshToken: 'r',
    //     // expiresAt: missing! → error TS2741
    //   });
  });

  it('deriveNoAuthProviders matches the explicit auth.kind === none set', () => {
    const derived = deriveNoAuthProviders(CONNECTOR_REGISTRATIONS);
    const explicit = new Set(
      CONNECTOR_REGISTRATIONS.filter((r) => r.auth.kind === 'none').map((r) => r.providerId),
    );
    expect([...derived].sort()).toEqual([...explicit].sort());
    // Sanity: known no-auth providers are in the set.
    expect(derived.has('mintlify')).toBe(true);
    expect(derived.has('zendesk')).toBe(true);
  });

  it('deriveServiceAccountProviders matches the explicit auth.kind === serviceAccount set', () => {
    const derived = deriveServiceAccountProviders(CONNECTOR_REGISTRATIONS);
    expect([...derived].sort()).toEqual(['google-chat', 'googledrive']);
  });

  it('deriveSyncIntervals returns a record keyed by every provider', () => {
    const derived = deriveSyncIntervals(CONNECTOR_REGISTRATIONS);
    for (const provider of SYNC_PROVIDERS) {
      expect(derived[provider]).toBe(SYNC_INTERVAL_MS_BY_PROVIDER[provider]);
    }
  });

  it('createSpec returns a ConnectorSpec whose id matches the registration providerId', () => {
    // For connectors that don't need env-supplied boot options, the spec
    // is constructed in tests with the no-op default. The two connectors
    // whose factories require options (slack, gitlab) accept empty
    // clientId/secret because the worker registers them at boot before
    // env is read in tests.
    for (const reg of CONNECTOR_REGISTRATIONS) {
      if (reg.providerId === 'github' || reg.providerId === 'webcrawl') {
        // These registrations require env-supplied boot options
        // (GithubSpecOptions / WebcrawlSpecOptions); constructing their
        // specs here would fail without env — verified via dedicated
        // tests below.
        continue;
      }
      const spec = reg.createSpec({});
      expect(spec.id).toBe(reg.providerId);
      expect(spec.sync.intervalMs).toBe(reg.syncIntervalMs);
    }
  });

  it('github registration createSpec throws without options', () => {
    const reg = CONNECTOR_REGISTRATIONS_BY_PROVIDER.github;
    expect(() => reg.createSpec({})).toThrow(/GithubSpecOptions/);
  });

  it('webcrawl registration createSpec throws without options', () => {
    const reg = CONNECTOR_REGISTRATIONS_BY_PROVIDER.webcrawl;
    expect(() => reg.createSpec({})).toThrow(/WebcrawlSpecOptions/);
  });
});

describe('defineConnectorRegistration runtime guards', () => {
  it('rejects a providerId not in SYNC_PROVIDERS', () => {
    expect(() =>
      defineConnectorRegistration({
        providerId: 'not-a-real-provider' as SyncProvider,
        syncIntervalMs: 60_000,
        auth: { kind: 'apiKey' },
        createSpec: () => {
          throw new Error('unused');
        },
      }),
    ).toThrow(/not in SYNC_PROVIDERS/);
  });

  it('rejects non-positive syncIntervalMs', () => {
    expect(() =>
      defineConnectorRegistration({
        providerId: 'slack',
        syncIntervalMs: 0,
        auth: { kind: 'apiKey' },
        createSpec: () => {
          throw new Error('unused');
        },
      }),
    ).toThrow(/syncIntervalMs/);
  });
});

describe('indexRegistrations', () => {
  function noopReg(providerId: SyncProvider): ConnectorRegistration {
    return defineConnectorRegistration({
      providerId,
      syncIntervalMs: 60_000,
      auth: { kind: 'apiKey' },
      createSpec: () => {
        throw new Error('unused');
      },
    });
  }

  it('throws if SYNC_PROVIDERS has an entry without a registration', () => {
    const partial = SYNC_PROVIDERS.slice(0, 2).map(noopReg);
    expect(() => indexRegistrations(partial)).toThrow(/missing registrations/);
  });

  it('throws on duplicate providerId', () => {
    const dup = [noopReg('slack'), noopReg('slack')];
    expect(() => indexRegistrations(dup)).toThrow(/duplicate/);
  });
});
