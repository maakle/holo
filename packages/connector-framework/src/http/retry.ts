import type { RetryConfig } from './types';

const DEFAULTS = {
  maxAttempts: 4,
  retryOn: [429, 502, 503, 504] as const,
  honorRetryAfter: true,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
};

export function resolveRetry(config?: RetryConfig): Required<RetryConfig> {
  return {
    maxAttempts: config?.maxAttempts ?? DEFAULTS.maxAttempts,
    retryOn: config?.retryOn ?? DEFAULTS.retryOn,
    honorRetryAfter: config?.honorRetryAfter ?? DEFAULTS.honorRetryAfter,
    initialDelayMs: config?.initialDelayMs ?? DEFAULTS.initialDelayMs,
    maxDelayMs: config?.maxDelayMs ?? DEFAULTS.maxDelayMs,
  };
}

/**
 * Parse a Retry-After header per RFC 7231. Supports both delta-seconds
 * and HTTP-date forms; returns ms (clamped to >= 0).
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now);
  }
  return null;
}

export function exponentialBackoff(
  attempt: number,
  config: { initialDelayMs: number; maxDelayMs: number },
): number {
  const raw = config.initialDelayMs * Math.pow(2, attempt - 1);
  return Math.min(raw, config.maxDelayMs);
}

/** Jitter helper: returns a value in [base*0.75, base*1.25]. */
export function jitter(base: number, rand: () => number = Math.random): number {
  return Math.round(base * (0.75 + rand() * 0.5));
}
