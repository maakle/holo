import type { ReactNode } from 'react';
import type { ConnectorMeta } from '@/lib/connector-registry';

/**
 * Context handed to each step. Steps own their content + footer; the wizard
 * frame just provides navigation primitives and the shared state bag.
 */
export interface WizardContext<TState = Record<string, unknown>> {
  meta: ConnectorMeta;
  /** Whether the connector is currently connected (server data). */
  connected: boolean;
  /** Display name of the connected workspace/account, when available. */
  connectedAs?: string;
  /**
   * When true, credential-entry steps (apikey, service-account) should render
   * the input form even if `connected` is true. Set by the "Reconnect" flow
   * in the manage sheet so users can rotate a key or paste a new service
   * account JSON without disconnecting first.
   */
  forceCredentialEntry?: boolean;
  /** Shared state passed between steps. Each connector defines its own shape. */
  state: TState;
  /** Shallow-merge patch into the shared state. */
  setState: (patch: Partial<TState>) => void;
  /** Advance to the next step (clamped at the last step). */
  goNext: () => void;
  /** Step back (clamped at 0). */
  goPrev: () => void;
  /** Close the wizard. */
  close: () => void;
  /** Re-fetch server data (router.refresh). Use after server-mutating actions. */
  refreshServer: () => void;
}

export interface WizardStep<TState = Record<string, unknown>> {
  /** Stable identifier — used for `initialStepId` and skip predicates. */
  id: string;
  /** Short label shown in the stepper indicator. */
  label: string;
  /** Renders step body + footer buttons. Steps own their CTAs. */
  render: (ctx: WizardContext<TState>) => ReactNode;
}

export interface ConnectorWizardConfig<TState = Record<string, unknown>> {
  steps: WizardStep<TState>[];
  /** Initial shared-state shape. */
  initialState: TState;
}
