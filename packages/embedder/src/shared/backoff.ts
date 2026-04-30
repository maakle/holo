import { APIError } from 'openai';
import { holoError, ErrorCode } from '@holo/errors';

export interface BackoffOptions {
  /** Human-readable name of the upstream service (for error messages). */
  upstream: string;
  /** Maximum number of attempts (initial + retries). Default: 5. */
  maxAttempts?: number;
  /** Base delay in ms; doubles each retry, capped at 8000. Default: 1000. */
  baseDelayMs?: number;
  /**
   * Sleep function. Defaults to a real setTimeout-based sleep.
   * Inject `() => Promise.resolve()` in tests to skip actual waiting.
   */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(err: unknown): boolean {
  if (err instanceof APIError) {
    return err.status === 429 || (err.status >= 500 && err.status < 600);
  }
  return false;
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryable(err)) {
        throw err;
      }
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, 8000);
        await sleep(delay);
      }
    }
  }

  throw holoError({
    code: ErrorCode.HOLO_INGESTION_RATE_LIMITED,
    problem: `${opts.upstream} embedding rate-limited or server-errored after ${maxAttempts} attempts`,
    cause: lastErr instanceof Error ? lastErr.message : String(lastErr),
    fix: 'Wait for rate-limit window to reset, or reduce embedding throughput',
  });
}
