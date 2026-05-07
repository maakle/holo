import type { RateLimitConfig } from './types';

/**
 * Token-bucket rate limiter. Each `take()` call resolves once a token is
 * available; tokens refill continuously at `rps` per second up to `burst`.
 *
 * Designed for in-process use only — for distributed limits use a Redis-
 * backed bucket. Within a single sync job that's fine: connectors hold the
 * limiter for the duration of their sync.
 */
export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private lastRefill: number;
  private readonly waiters: Array<() => void> = [];

  constructor(config: RateLimitConfig, now: () => number = Date.now) {
    this.capacity = config.burst ?? config.rps;
    this.tokens = this.capacity;
    this.refillPerMs = config.rps / 1000;
    this.lastRefill = now();
    this.now = now;
  }

  private readonly now: () => number;

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = t;
  }

  /**
   * Wait until a token is available, then consume one.
   * The promise resolves cooperatively — multiple waiters are released
   * in FIFO order as tokens refill.
   */
  async take(signal?: AbortSignal): Promise<void> {
    this.refill();
    if (this.tokens >= 1 && this.waiters.length === 0) {
      this.tokens -= 1;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        const idx = this.waiters.indexOf(release);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(signal?.reason ?? new Error('aborted'));
      };
      const release = (): void => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      this.waiters.push(release);
      signal?.addEventListener('abort', onAbort, { once: true });
      this.scheduleDrain();
    });
  }

  private drainTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleDrain(): void {
    if (this.drainTimer) return;
    this.refill();
    while (this.tokens >= 1 && this.waiters.length > 0) {
      this.tokens -= 1;
      const next = this.waiters.shift();
      next?.();
    }
    if (this.waiters.length === 0) return;
    const tokensNeeded = 1 - this.tokens;
    const waitMs = Math.max(1, Math.ceil(tokensNeeded / this.refillPerMs));
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.scheduleDrain();
    }, waitMs);
    // Don't keep the process alive purely for a rate-limit drain.
    if (typeof this.drainTimer === 'object' && this.drainTimer && 'unref' in this.drainTimer) {
      (this.drainTimer as { unref(): void }).unref();
    }
  }
}
