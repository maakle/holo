import { PostHog } from 'posthog-node';
import type { Env } from '@holo/env';

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

/**
 * Build the gateway's PostHog client from already-parsed env. Returns a
 * structural no-op when no key is set so call sites can `capture(...)`
 * unconditionally and self-hosters get zero outbound analytics.
 */
export function createPosthog(env: Env): PosthogLike {
  if (!env.POSTHOG_API_KEY) return NO_OP;
  return new PostHog(env.POSTHOG_API_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST,
  });
}

export type Posthog = PosthogLike;
