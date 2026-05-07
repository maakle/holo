import { ErrorCode, holoError } from '@holo/errors';
import type { AuthStrategy, RefreshInput } from './types';
import type { ConnectorTokens } from '../types';

export interface ApiKeyConfig {
  /** Header to set: defaults to 'Authorization'. */
  header?: string;
  /** Prefix prepended to the key value (e.g. 'Bearer ', 'Token '). */
  prefix?: string;
}

/**
 * Static-token strategy. Notion, Pylon, HubSpot all use this — the user
 * pastes a token string, we validate it via testConnection, and then attach
 * it on every request. There is no authorize/exchange step; the connector
 * UI collects the key directly.
 */
export function apiKey(config: ApiKeyConfig = {}): AuthStrategy {
  const header = config.header ?? 'Authorization';
  const prefix = config.prefix ?? 'Bearer ';

  return {
    kind: 'apiKey',
    refreshable: false,

    authHeader(tokens: ConnectorTokens) {
      return { name: header, value: `${prefix}${tokens.accessToken}` };
    },

    async refresh(_input: RefreshInput): Promise<ConnectorTokens> {
      throw holoError({
        code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
        problem: 'API-key auth does not support refresh',
        fix: 'Re-paste the API key in the integration settings.',
      });
    },
  };
}
