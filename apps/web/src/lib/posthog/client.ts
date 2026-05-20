'use client';

import posthog, { type PostHog } from 'posthog-js';

const DEFAULT_HOST = 'https://eu.i.posthog.com';

/**
 * Minimal surface of posthog-js the rest of the app touches. We expose
 * exactly the methods we use so the no-op fallback can stay tiny and
 * typed, and so callers never have to null-check.
 */
type PostHogLike = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
  identify: (
    distinctId: string,
    userProperties?: Record<string, unknown>,
  ) => void;
  group: (
    groupType: string,
    groupKey: string,
    groupProperties?: Record<string, unknown>,
  ) => void;
  reset: () => void;
};

const NO_OP: PostHogLike = {
  capture: () => {},
  identify: () => {},
  group: () => {},
  reset: () => {},
};

let started = false;

export function initPostHogBrowser(): PostHog | null {
  if (typeof window === 'undefined') return null;
  if (started) return posthog;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  started = true;
  posthog.init(key, {
    // Browser POSTs to Holo's own origin (see next.config.mjs rewrites).
    // Keeps events flowing even with ad blockers that target *.posthog.com.
    api_host: '/ingest',
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_HOST,
    // Anonymous visitors don't create person profiles. We only mint one
    // when an authenticated user is identified inside the dashboard.
    person_profiles: 'identified_only',
    // We send pageviews manually from <PostHogPageview /> so we can react
    // to client-side route changes that PostHog's auto handler misses.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    disable_session_recording: true,
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') {
        ph.debug(false);
      }
    },
  });
  return posthog;
}

/**
 * Returns the live PostHog client when analytics are configured, or a
 * structural no-op otherwise. Callers can always invoke `.capture(...)` /
 * `.identify(...)` without guarding on a key being present.
 */
export function posthogClient(): PostHogLike {
  if (typeof window === 'undefined') return NO_OP;
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return NO_OP;
  if (!started) initPostHogBrowser();
  return posthog;
}
