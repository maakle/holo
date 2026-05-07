import { ErrorCode, holoError } from '@holo/errors';
import type { AuthStrategy } from '../auth/types';
import type { ConnectorTokens } from '../types';
import { TokenBucket } from './rate-limit';
import { exponentialBackoff, jitter, parseRetryAfter, resolveRetry } from './retry';
import type { HttpClient, HttpConfig, RequestOptions } from './types';

export interface CreateHttpClientInput {
  config: HttpConfig;
  auth: AuthStrategy;
  tokens: ConnectorTokens;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Wall-clock for retry/backoff (tests). */
  now?: () => number;
  /** Sleep impl (tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Random source for jitter (tests). */
  rand?: () => number;
}

const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('aborted'));
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (typeof timer === 'object' && timer && 'unref' in timer) {
      (timer as { unref(): void }).unref();
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(path.startsWith('/') ? `${trimmedBase}${path}` : path, trimmedBase + '/');
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function createHttpClient(input: CreateHttpClientInput): HttpClient {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;
  const rand = input.rand ?? Math.random;
  const bucket = input.config.rateLimit ? new TokenBucket(input.config.rateLimit, now) : null;
  const defaultRetry = resolveRetry(input.config.retry);
  const errorBodyToMessage = input.config.errorBodyToMessage;

  async function once(
    method: string,
    url: string,
    opts: RequestOptions | undefined,
  ): Promise<Response> {
    const headers = new Headers(input.config.defaultHeaders ?? {});
    if (opts?.headers) {
      for (const [k, v] of Object.entries(opts.headers)) headers.set(k, v);
    }
    const { name, value } = input.auth.authHeader(input.tokens);
    if (!headers.has(name)) headers.set(name, value);

    let body: string | URLSearchParams | undefined;
    if (opts?.body !== undefined) {
      if (typeof opts.body === 'string' || opts.body instanceof URLSearchParams) {
        body = opts.body;
        if (opts.body instanceof URLSearchParams && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/x-www-form-urlencoded');
        }
      } else {
        body = JSON.stringify(opts.body);
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
      }
    }

    if (bucket) await bucket.take(opts?.signal);
    return fetchImpl(url, { method, headers, body, signal: opts?.signal });
  }

  async function withRetry<T>(
    method: string,
    path: string,
    opts: RequestOptions | undefined,
  ): Promise<T> {
    const retry = opts?.retry ? resolveRetry(opts.retry) : defaultRetry;
    const url = buildUrl(input.config.baseUrl, path, opts?.query);
    let lastErr: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      let res: Response;
      try {
        res = await once(method, url, opts);
      } catch (err) {
        // Network error — retry unless aborted.
        if (opts?.signal?.aborted) throw err;
        lastErr = err;
        if (attempt === retry.maxAttempts) {
          throw holoError({
            code: ErrorCode.HOLO_FETCH_FAILED,
            problem: `${method} ${url} threw after ${attempt} attempts`,
            cause: (err as Error).message,
            fix: 'Check connectivity to the provider; retry the sync.',
          });
        }
        await sleep(jitter(exponentialBackoff(attempt, retry), rand), opts?.signal);
        continue;
      }

      if (res.ok) {
        // Most providers return JSON; handle 204 / empty body cleanly.
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        if (text.length === 0) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch (err) {
          throw holoError({
            code: ErrorCode.HOLO_FETCH_FAILED,
            problem: `${method} ${url} returned non-JSON body (${res.status})`,
            cause: (err as Error).message,
            fix: 'Provider returned an unexpected body shape; check API status.',
          });
        }
      }

      const isRetryable =
        retry.retryOn.includes(res.status) && attempt < retry.maxAttempts;
      if (!isRetryable) {
        const body = await res.text().catch(() => '');
        let parsed: unknown = body;
        try {
          parsed = JSON.parse(body);
        } catch {
          /* leave as text */
        }
        const detail = errorBodyToMessage?.(parsed, res.status) ?? body.slice(0, 500);
        throw holoError({
          code: ErrorCode.HOLO_FETCH_FAILED,
          problem: `${method} ${url} returned ${res.status}`,
          cause: detail,
          fix:
            res.status === 401 || res.status === 403
              ? 'Re-authenticate the integration.'
              : 'Retry the sync; if it persists, check provider status.',
        });
      }

      // Retryable — back off and try again.
      let waitMs = jitter(exponentialBackoff(attempt, retry), rand);
      if (retry.honorRetryAfter) {
        const hint = parseRetryAfter(res.headers.get('Retry-After'), now());
        if (hint !== null) waitMs = Math.max(waitMs, hint);
      }
      lastErr = res;
      await sleep(Math.min(waitMs, retry.maxDelayMs), opts?.signal);
    }

    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `${method} ${path} exhausted ${retry.maxAttempts} attempts`,
      cause: lastErr instanceof Error ? lastErr.message : 'unknown',
      fix: 'Retry later; the provider returned retryable errors repeatedly.',
    });
  }

  return {
    get: <T>(path: string, opts?: RequestOptions): Promise<T> => withRetry<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> =>
      withRetry<T>('POST', path, { ...opts, body }),
    request: <T>(method: string, path: string, opts?: RequestOptions): Promise<T> =>
      withRetry<T>(method, path, opts),
  };
}
