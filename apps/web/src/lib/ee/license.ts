/**
 * EE license gate. EE features live under `ee/` directories (see LICENSING.md);
 * this helper is the runtime check that decides whether a deployment is
 * entitled to use them.
 *
 * MVP gate:
 *   - `HOLO_EE_LICENSE_KEY` set → EE features active in this deployment.
 *   - Unset → EE features blocked. The MIT CE files still build and run;
 *     only the EE-only surfaces (custom Slack app, etc.) refuse to operate.
 *
 * In dev / evaluation use the customer sets a placeholder value while they
 * trial the feature. Production enforcement (validating the key against a
 * license server, expiry checks, seat counts) lives in a follow-up — for
 * now the field is presence-checked only, matching the "free to evaluate"
 * stance in LICENSING.md.
 */
export function isEnterpriseEnabled(): boolean {
  const key = process.env.HOLO_EE_LICENSE_KEY;
  return typeof key === 'string' && key.length > 0;
}

export const EE_DISABLED_REASON =
  'This is an Enterprise Edition feature. Set HOLO_EE_LICENSE_KEY in your deployment to enable it.';
