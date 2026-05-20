/**
 * HOLO_BILLING_ENABLED gates every write into the credit ledger and every
 * upgrade-modal gate on the connections page. CE / self-hosted installs leave
 * this off (default) — the ledger schema exists but stays empty and nothing
 * blocks the user. Hosted holo sets it to `'true'` in its environment.
 *
 * Why a runtime env flag rather than a build-time constant: the same compiled
 * artifact ships to hosted-holo and to self-hosters. The flag is read once
 * per process via `billingEnabled()` and cached, so the per-call cost is a
 * pointer deref.
 */

let cachedEnabled: boolean | null = null;

export function billingEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  cachedEnabled = process.env.HOLO_BILLING_ENABLED === 'true';
  return cachedEnabled;
}

/** Test hook. Resets the cached flag so each test can flip the env. */
export function resetBillingEnabledCache(): void {
  cachedEnabled = null;
}
