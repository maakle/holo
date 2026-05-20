import 'server-only';
import { PostHog } from 'posthog-node';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

type ServerPostHogLike = {
  capture: (input: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
    groups?: Record<string, string>;
  }) => void;
  identify: (input: {
    distinctId: string;
    properties?: Record<string, unknown>;
  }) => void;
  groupIdentify: (input: {
    groupType: string;
    groupKey: string;
    properties?: Record<string, unknown>;
  }) => void;
  shutdown: () => Promise<void>;
};

const NO_OP: ServerPostHogLike = {
  capture: () => {},
  identify: () => {},
  groupIdentify: () => {},
  shutdown: async () => {},
};

let cached: ServerPostHogLike | null = null;

/**
 * Lazy singleton wrapping posthog-node for server-side captures. Returns a
 * structural no-op when POSTHOG_API_KEY is unset, so any route handler can
 * call `getServerPosthog().capture(...)` unconditionally.
 *
 * We read `process.env` directly instead of going through @holo/env here
 * because route handlers run before `getServerContext()` in some edge
 * cases (e.g. /api/auth handlers) and we want analytics to be a no-op
 * even if env parsing has not yet succeeded.
 */
export function getServerPosthog(): ServerPostHogLike {
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
