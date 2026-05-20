/**
 * Canonical PostHog event taxonomy for the web app.
 *
 * Every event the web app sends — from the landing page or the dashboard —
 * is declared here exactly once with the shape of its custom properties.
 * `trackEvent` below is the only sanctioned way to capture from app code,
 * so a typo or stale property name becomes a type error instead of silent
 * data loss in PostHog.
 *
 * keep in sync with docs/analytics.md
 */

import { posthogClient } from './client';

export type LandingLocation =
  | 'hero'
  | 'final'
  | 'header'
  | 'open-source-band';

export type LandingSection =
  | 'platform'
  | 'connectors'
  | 'open-source'
  | 'observability'
  | 'security'
  | 'use-cases'
  | 'benchmarks';

export type WebEventMap = {
  // ── Landing ────────────────────────────────────────────────────────────
  landing_cta_clicked: { location: LandingLocation; isAuthed: boolean };
  landing_install_copy: { location: LandingLocation };
  landing_github_clicked: { location: LandingLocation };
  landing_section_viewed: { section: LandingSection };

  // ── Dashboard ──────────────────────────────────────────────────────────
  workspace_created: { orgId: string };
  workspace_switched: { fromOrgId: string | null; toOrgId: string };
  connector_wizard_opened: { provider: string };
  connector_connected: { provider: string };
  connector_disconnected: { provider: string };
  chat_message_sent: { messageLength: number; hasAttachments: boolean };
  mcp_install_copied: { client: 'claude' | 'cursor' | 'other' };
  agent_invite_sent: { role: string };
  sample_data_seeded: Record<string, never>;
};

export type WebEventName = keyof WebEventMap;

export function trackEvent<E extends WebEventName>(
  name: E,
  props: WebEventMap[E],
): void {
  posthogClient().capture(name, props as Record<string, unknown>);
}
