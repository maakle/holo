import { holoError, ErrorCode } from '@holo/errors';

/**
 * Stripe env vars. All three are required when HOLO_BILLING_ENABLED is on
 * — the boot sequence (provisioning + checkout + webhook) refuses to run
 * without them. CE installs (HOLO_BILLING_ENABLED unset) never read these.
 *
 * Treat the secret + webhook keys as build-time secrets; the publishable key
 * is safe in the client bundle but we don't need Stripe.js in PR 2 (hosted
 * Checkout is a server-side redirect), so it stays server-only for now.
 */
export interface StripeEnv {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
}

export function readStripeEnv(): StripeEnv {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!secretKey || !webhookSecret || !publishableKey) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem:
        'Stripe billing is enabled but STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PUBLISHABLE_KEY are not all set',
      fix: 'Set the three Stripe env vars on the worker and web processes, or disable billing with HOLO_BILLING_ENABLED=false.',
    });
  }
  return { secretKey, webhookSecret, publishableKey };
}
