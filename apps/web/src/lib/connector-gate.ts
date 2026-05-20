import { canAddConnector, type ConnectorGateDecision } from '@holo/billing';
import { holoError, ErrorCode } from '@holo/errors';
import type { DB } from '@holo/db';

export interface PlanLimitErrorMeta {
  reason: 'plan_limit';
  currentPlanSlug: string;
  currentPlanName: string;
  limit: number;
  currentCount: number;
  suggestedUpgradeSlug: string;
}

/**
 * Server-side guard for every connector connect/finalize route. Throws a
 * structured HoloError with code `HOLO_PLAN_LIMIT_REACHED` when the org has
 * already used up its plan's `maxConnectors` budget and is trying to add a
 * new provider.
 *
 * Re-authenticating an existing provider (e.g. expired Slack token refresh)
 * is always allowed — only first-time additions of a new provider trigger
 * the gate.
 *
 * The thrown error carries structured `meta` that the connect-route catch
 * blocks serialize to the client; the upgrade modal in the UI parses it to
 * render the right copy and deep-link to /settings/billing.
 *
 * No-op when HOLO_BILLING_ENABLED is unset (self-hosted CE).
 */
export async function enforceConnectorLimit(
  db: DB,
  organizationId: string,
  provider: string,
): Promise<void> {
  const decision: ConnectorGateDecision = await canAddConnector(
    db,
    organizationId,
    provider,
  );
  if (decision.allowed) return;
  const meta: PlanLimitErrorMeta = {
    reason: 'plan_limit',
    currentPlanSlug: decision.currentPlanSlug,
    currentPlanName: decision.currentPlanName,
    limit: decision.limit,
    currentCount: decision.currentCount,
    suggestedUpgradeSlug: decision.suggestedUpgradeSlug,
  };
  throw holoError({
    code: ErrorCode.HOLO_PLAN_LIMIT_REACHED,
    problem: `Your ${decision.currentPlanName} plan includes ${decision.limit} connector${decision.limit === 1 ? '' : 's'}. You're already using ${decision.currentCount}.`,
    fix: 'Upgrade your plan to connect more sources.',
    meta: meta as unknown as Record<string, unknown>,
  });
}
