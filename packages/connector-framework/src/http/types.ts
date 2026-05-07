export interface RateLimitConfig {
  /** Steady-state requests per second. */
  rps: number;
  /** Maximum burst the bucket can absorb. Defaults to `rps`. */
  burst?: number;
}

export interface RetryConfig {
  /** Total attempts including the first. Defaults to 4. */
  maxAttempts?: number;
  /** Status codes that should trigger a retry. Defaults to [429, 502, 503, 504]. */
  retryOn?: ReadonlyArray<number>;
  /** Honor a Retry-After header on retryable responses. Defaults to true. */
  honorRetryAfter?: boolean;
  /** Initial backoff in ms. Doubles each attempt. Defaults to 500. */
  initialDelayMs?: number;
  /** Cap on a single backoff step in ms. Defaults to 30_000. */
  maxDelayMs?: number;
}

export interface HttpConfig {
  baseUrl: string;
  rateLimit?: RateLimitConfig;
  retry?: RetryConfig;
  defaultHeaders?: Record<string, string>;
  /** When set, parse non-2xx JSON bodies through this hook to surface
   *  provider-specific error fields ({ ok: false, error } in Slack, etc.)
   *  in the error message. */
  errorBodyToMessage?: (body: unknown, status: number) => string | undefined;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** Override the default retry policy for this request only. */
  retry?: RetryConfig;
}

export interface HttpClient {
  get<T>(path: string, opts?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T>;
  request<T>(method: string, path: string, opts?: RequestOptions): Promise<T>;
}
