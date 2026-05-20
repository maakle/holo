import { PostHog } from 'posthog-node';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

type PosthogLike = {
  capture: (input: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    groups?: Record<string, string>;
  }) => void;
  shutdown: () => Promise<void>;
};

const NO_OP: PosthogLike = {
  capture: () => {},
  shutdown: async () => {},
};

let cached: PosthogLike | null = null;

/**
 * Lazy worker-wide PostHog singleton. Reads env directly because the
 * NestJS module graph doesn't always provide a clean DI hook for the
 * `SyncProcessorBase` abstract — and analytics should be a no-op when
 * unconfigured, regardless of DI wiring.
 */
export function getWorkerPosthog(): PosthogLike {
  if (cached) return cached;
  const key = process.env.POSTHOG_API_KEY;
  if (!key) {
    cached = NO_OP;
    return cached;
  }
  cached = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST,
  });
  return cached;
}
