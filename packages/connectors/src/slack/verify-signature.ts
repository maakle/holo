import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Slack signs every event payload (and slash command request) with HMAC-SHA256
 * over `v0:${timestamp}:${rawBody}` using your app's signing secret. The
 * computed digest is sent as `X-Slack-Signature: v0=<hex>` and the timestamp
 * as `X-Slack-Request-Timestamp`. Reference:
 * https://api.slack.com/authentication/verifying-requests-from-slack
 */

export const SLACK_REPLAY_WINDOW_SECONDS = 60 * 5;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: SlackVerifyFailure };

export type SlackVerifyFailure =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_signature'
  | 'replay_window_exceeded'
  | 'signature_mismatch';

export interface VerifySlackInput {
  signingSecret: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
  timestampHeader: string | null | undefined;
  /** Override for tests; defaults to Date.now() / 1000. */
  nowSeconds?: number;
}

export function verifySlackSignature(input: VerifySlackInput): VerifyResult {
  const { signingSecret, rawBody, signatureHeader, timestampHeader } = input;

  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  // The signature is "v0=<hex>"; reject anything that isn't shaped like that
  // before doing crypto work. Slack only ever uses v0 today.
  if (!signatureHeader.startsWith('v0=')) {
    return { ok: false, reason: 'malformed_signature' };
  }
  const providedHex = signatureHeader.slice(3);
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { ok: false, reason: 'malformed_signature' };
  }

  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum)) {
    return { ok: false, reason: 'missing_timestamp' };
  }

  // Replay protection. Slack retries up to ~1h, but the *signed* timestamp is
  // when Slack sent the original request — if it's older than 5 minutes it's
  // either a replay attack or hopelessly stale, and we should refuse rather
  // than process a queue of resent events out of order.
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNum) > SLACK_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'replay_window_exceeded' };
  }

  const base = `v0:${timestampHeader}:${rawBody}`;
  const expectedHex = createHmac('sha256', signingSecret).update(base).digest('hex');

  // timingSafeEqual requires equal-length buffers. Mismatched length is
  // automatically a fail, but compare lengths first to avoid the throw.
  if (expectedHex.length !== providedHex.length) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  const a = Buffer.from(expectedHex, 'utf8');
  const b = Buffer.from(providedHex.toLowerCase(), 'utf8');
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
