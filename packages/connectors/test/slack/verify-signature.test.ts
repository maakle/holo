import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySlackSignature } from '../../src/slack/verify-signature';

const SECRET = '8f742231b10e8888abcd99yyyzzz85a5';

function sign(body: string, ts: number): string {
  return (
    'v0=' +
    createHmac('sha256', SECRET)
      .update(`v0:${ts}:${body}`)
      .digest('hex')
  );
}

describe('verifySlackSignature', () => {
  const now = 1_700_000_000;
  const body = '{"type":"event_callback","event_id":"Ev123"}';

  it('accepts a correctly signed fresh request', () => {
    const sig = sign(body, now);
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects when signature header is missing', () => {
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: null,
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_signature' });
  });

  it('rejects when timestamp header is missing', () => {
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: sign(body, now),
      timestampHeader: null,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'missing_timestamp' });
  });

  it('rejects malformed signatures (wrong prefix)', () => {
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: 'v1=abc',
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'malformed_signature' });
  });

  it('rejects malformed signatures (non-hex chars)', () => {
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: 'v0=zzznothex',
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'malformed_signature' });
  });

  it('rejects requests outside the 5-minute replay window', () => {
    const oldTs = now - 6 * 60;
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body,
      signatureHeader: sign(body, oldTs),
      timestampHeader: String(oldTs),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'replay_window_exceeded' });
  });

  it('rejects when signature does not match (different body)', () => {
    const sig = sign(body, now);
    const result = verifySlackSignature({
      signingSecret: SECRET,
      rawBody: body + '/* tampered */',
      signatureHeader: sig,
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });

  it('rejects when signature does not match (different secret)', () => {
    const sig = sign(body, now);
    const result = verifySlackSignature({
      signingSecret: 'a-different-secret-with-enough-length-to-be-realistic',
      rawBody: body,
      signatureHeader: sig,
      timestampHeader: String(now),
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'signature_mismatch' });
  });
});
