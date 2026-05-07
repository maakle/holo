import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookEnvelope, WebhookVerifier } from './types';

export interface HmacConfig {
  /** Header that carries the signature (case-insensitive lookup). */
  headerName: string;
  /** HMAC algorithm. */
  algo: 'sha256' | 'sha1' | 'sha512';
  /** How the signature is encoded. Defaults to 'hex'. */
  encoding?: 'hex' | 'base64';
  /** Optional fixed prefix to strip from the header (e.g. 'sha256='). */
  prefix?: string;
  /** Replay-protection: max acceptable age in seconds for a timestamped header. */
  replayWindowSeconds?: number;
  /**
   * If set, the signed payload is `${timestamp}:${rawBody}` and the timestamp
   * is read from this header. Used by Slack, Stripe-style schemes.
   */
  timestampHeader?: string;
  /** Custom function to assemble the signed message; overrides default. */
  buildSignedMessage?: (env: WebhookEnvelope) => string;
  /** Wall-clock for replay window check (tests). */
  now?: () => number;
}

function lookupHeader(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * HMAC signature verifier shared by GitHub, Slack, Linear, and most OAuth-app
 * webhooks. Supports plain `HMAC(body)` schemes (GitHub) and the timestamped
 * `HMAC(timestamp:body)` variant (Slack, Stripe).
 */
export function webhookHmac(config: HmacConfig): WebhookVerifier {
  const encoding = config.encoding ?? 'hex';
  const now = config.now ?? Date.now;

  return {
    verify(env: WebhookEnvelope, secret: string): boolean {
      const headerVal = lookupHeader(env.headers, config.headerName);
      if (!headerVal) return false;

      const expected = config.prefix ? headerVal.slice(config.prefix.length) : headerVal;
      if (config.prefix && !headerVal.startsWith(config.prefix)) return false;

      let signedMessage: string;
      if (config.buildSignedMessage) {
        signedMessage = config.buildSignedMessage(env);
      } else if (config.timestampHeader) {
        const ts = lookupHeader(env.headers, config.timestampHeader);
        if (!ts) return false;
        if (config.replayWindowSeconds !== undefined) {
          const tsMs = parseInt(ts, 10) * 1000;
          if (Number.isNaN(tsMs)) return false;
          if (Math.abs(now() - tsMs) > config.replayWindowSeconds * 1000) return false;
        }
        signedMessage = `${ts}:${env.rawBody}`;
      } else {
        signedMessage = env.rawBody;
      }

      const computed = createHmac(config.algo, secret).update(signedMessage).digest(encoding);
      return constantTimeEqual(computed, expected);
    },
  };
}
