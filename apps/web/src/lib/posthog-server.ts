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
 * Server-side PostHog singleton for the web app. Mirrors
 * `apps/worker/src/posthog.ts` so events emitted from API routes and from
 * the worker land in the same project with the same shape.
 *
 * No-op when POSTHOG_API_KEY is unset (local / self-hosted installs).
 */
export function getServerPosthog(): PosthogLike {
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

/**
 * Convenience: capture an org-scoped event with the standard distinctId +
 * groups shape, so analytics joins on `organization` group properties work
 * across every event the pricing funnel emits.
 */
export function captureOrgEvent(args: {
  organizationId: string;
  event: string;
  properties?: Record<string, unknown>;
}): void {
  getServerPosthog().capture({
    distinctId: `org:${args.organizationId}`,
    event: args.event,
    ...(args.properties ? { properties: args.properties } : {}),
    groups: { organization: args.organizationId },
  });
}
