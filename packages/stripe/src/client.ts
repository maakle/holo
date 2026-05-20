import Stripe from 'stripe';
import { readStripeEnv } from './env';

let cached: Stripe | null = null;

/**
 * Singleton Stripe client. Cached at module scope so a single process opens
 * exactly one HTTP keep-alive pool. The Stripe SDK is stateless so a single
 * client works across all routes / queues / web requests.
 *
 * `apiVersion: '2025-09-30.clover'` pins us to a known API version so a
 * Stripe-side rollout can't silently shift behavior. Bump explicitly when we
 * intentionally want new fields.
 */
export function getStripeClient(): Stripe {
  if (cached) return cached;
  const env = readStripeEnv();
  cached = new Stripe(env.secretKey, {
    apiVersion: '2025-08-27.basil',
    typescript: true,
    appInfo: {
      name: 'holo',
      url: 'https://maakle.com/holo',
    },
  });
  return cached;
}

/** Test hook. Reset the cached client (and the env cache) between tests. */
export function resetStripeClient(): void {
  cached = null;
}
