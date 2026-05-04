/**
 * GitHub App webhook utilities.
 *
 * Webhook security: GitHub signs every delivery with HMAC-SHA256 over the
 * raw request body, using the per-app secret. The signature ships in the
 * `X-Hub-Signature-256` header as `sha256=<hex>`. We verify in constant time
 * to prevent timing attacks on secret recovery.
 *
 * Why a separate helper: the verification has to happen on the *raw* body
 * before JSON parsing (whitespace and key ordering matter for the signature).
 * Centralizing here keeps the route handler from having to remember that.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifyResult {
  ok: boolean;
  /** Brief machine-readable reason when ok=false. */
  reason?: 'missing-signature' | 'malformed-signature' | 'mismatch';
}

/**
 * Verifies a GitHub webhook signature against the raw body and shared secret.
 * Returns ok=false with a reason rather than throwing — the caller decides
 * whether to 401 or 400.
 */
export function verifyGithubWebhookSignature(args: {
  rawBody: string;
  signatureHeader: string | null | undefined;
  secret: string;
}): VerifyResult {
  if (!args.signatureHeader) return { ok: false, reason: 'missing-signature' };
  if (!args.signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'malformed-signature' };
  }
  const provided = args.signatureHeader.slice('sha256='.length);
  // Hex strings: 64 chars for sha256.
  if (provided.length !== 64 || !/^[0-9a-f]+$/i.test(provided)) {
    return { ok: false, reason: 'malformed-signature' };
  }

  const expected = createHmac('sha256', args.secret).update(args.rawBody).digest('hex');

  // timingSafeEqual requires equal-length buffers, which we've enforced above.
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return { ok: false, reason: 'mismatch' };
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' };
}

/**
 * GitHub's documented webhook event names. We only enumerate what we
 * actually handle; everything else is dropped at the dispatch layer.
 */
export const GITHUB_WEBHOOK_EVENTS = [
  'installation',
  'installation_repositories',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'issues',
  'issue_comment',
  'push',
] as const;
export type GithubWebhookEvent = (typeof GITHUB_WEBHOOK_EVENTS)[number];

export function isHandledEvent(event: string): event is GithubWebhookEvent {
  return (GITHUB_WEBHOOK_EVENTS as readonly string[]).includes(event);
}
