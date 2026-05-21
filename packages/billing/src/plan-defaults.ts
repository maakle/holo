/**
 * Canonical hard caps per plan slug, used as the source of truth for both
 * enforcement (`checkStorageQuota`) and presentation (settings/billing
 * PlanGrid, the landing page PricingBand). The DB `billing_plans.features`
 * JSONB is the authoritative store, but a row created by an older migration
 * (or one that hasn't been re-seeded) may be missing the
 * `maxStoredChunks` key. We fall back to these defaults so:
 *
 *   - the UI never falsely advertises "Unlimited"
 *   - the gate stays armed even if a migration is pending
 *
 * Keep these in sync with the seed values in
 * `packages/db/migrations/0067_storage_caps.sql`. If you tune one, tune both.
 */
export const PLAN_DEFAULT_STORAGE_CAP: Record<string, number | null> = {
  free: 10_000,
  starter: 100_000,
  team: 1_000_000,
  business: 10_000_000,
  enterprise: null,
};

/**
 * Resolve a plan's effective storage cap. Order of precedence:
 *   1. value on the row's `features` JSONB (if set explicitly, even to null)
 *   2. canonical default for the slug
 *   3. `null` (unlimited) as a last resort
 *
 * `featureValue` is `undefined` when the JSONB key is missing entirely (the
 * common case for legacy rows). It can be explicitly `null` to mean
 * "intentionally unlimited" — e.g. enterprise — and we honour that.
 */
export function resolveStorageCap(
  slug: string,
  featureValue: number | null | undefined,
): number | null {
  if (featureValue !== undefined) return featureValue;
  return PLAN_DEFAULT_STORAGE_CAP[slug] ?? null;
}
