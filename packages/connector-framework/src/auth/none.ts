import { ErrorCode, holoError } from '@holo/errors';
import type { AuthStrategy, RefreshInput } from './types';
import type { ConnectorTokens } from '../types';

/**
 * No-auth strategy. For connectors that hit fully public surfaces
 * (Mintlify-hosted docs, sitemaps, RSS feeds, public APIs without keys).
 *
 * The framework still calls `loadTokens` for these specs — the host
 * returns whatever placeholder it likes (typically empty string), and
 * `authHeader` is a no-op so no Authorization header gets attached to
 * outbound requests.
 */
export function none(): AuthStrategy {
  return {
    kind: 'none',
    refreshable: false,

    authHeader(_tokens: ConnectorTokens) {
      // The HTTP client special-cases this kind: a header named '' is
      // skipped instead of attached.
      return { name: '', value: '' };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'No-auth strategy does not support refresh',
        fix: 'There is no token to refresh — public surfaces have no auth state.',
      });
    },
  };
}
