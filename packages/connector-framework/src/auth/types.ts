import type { ConnectorTokens } from '../types';

export type AuthKind = 'oauth2' | 'apiKey' | 'githubApp' | 'none';

export interface BuildAuthorizeUrlInput {
  redirectUri: string;
  state: string;
  /** Optional scope override; defaults to the strategy's configured scopes. */
  scopes?: ReadonlyArray<string>;
}

export interface ExchangeCodeInput {
  code: string;
  redirectUri: string;
}

export interface RefreshInput {
  refreshToken: string;
}

/**
 * Auth strategies are the only place where the framework knows about an
 * individual provider's auth quirks. The runtime composes a strategy plus
 * an HTTP config to produce the runner's `tokens → api client` pipeline.
 */
export interface AuthStrategy {
  readonly kind: AuthKind;
  /** True when refresh() can be called without throwing NOT_IMPLEMENTED. */
  readonly refreshable: boolean;
  /** Header name (e.g. 'Authorization') the framework should set on requests. */
  authHeader(tokens: ConnectorTokens): { name: string; value: string };
  buildAuthorizeUrl?(input: BuildAuthorizeUrlInput): string;
  exchangeCode?(input: ExchangeCodeInput): Promise<ConnectorTokens>;
  refresh(input: RefreshInput): Promise<ConnectorTokens>;
}
