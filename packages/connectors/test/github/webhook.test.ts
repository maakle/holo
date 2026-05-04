import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifyGithubWebhookSignature,
  isHandledEvent,
} from '../../src/github/webhook';

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyGithubWebhookSignature', () => {
  const secret = 'test-secret-test-secret-test';
  const body = '{"action":"created","installation":{"id":42}}';

  it('accepts a correctly signed payload', () => {
    const result = verifyGithubWebhookSignature({
      rawBody: body,
      signatureHeader: sign(body, secret),
      secret,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when the signature header is missing', () => {
    expect(
      verifyGithubWebhookSignature({ rawBody: body, signatureHeader: null, secret }),
    ).toEqual({ ok: false, reason: 'missing-signature' });
  });

  it('rejects when the signature does not start with sha256=', () => {
    expect(
      verifyGithubWebhookSignature({
        rawBody: body,
        signatureHeader: 'sha1=abc',
        secret,
      }).reason,
    ).toBe('malformed-signature');
  });

  it('rejects when the hex digest is the wrong length', () => {
    expect(
      verifyGithubWebhookSignature({
        rawBody: body,
        signatureHeader: 'sha256=deadbeef',
        secret,
      }).reason,
    ).toBe('malformed-signature');
  });

  it('rejects when the signature is hex-shaped but wrong', () => {
    const wrong = 'sha256=' + 'a'.repeat(64);
    expect(
      verifyGithubWebhookSignature({ rawBody: body, signatureHeader: wrong, secret })
        .reason,
    ).toBe('mismatch');
  });

  it('rejects when the body has been tampered with', () => {
    const sig = sign(body, secret);
    const tamperedBody = body.replace('"id":42', '"id":99');
    expect(
      verifyGithubWebhookSignature({
        rawBody: tamperedBody,
        signatureHeader: sig,
        secret,
      }).reason,
    ).toBe('mismatch');
  });

  it('rejects when signed with the wrong secret', () => {
    expect(
      verifyGithubWebhookSignature({
        rawBody: body,
        signatureHeader: sign(body, 'different-secret'),
        secret,
      }).reason,
    ).toBe('mismatch');
  });
});

describe('isHandledEvent', () => {
  it('returns true for events we actually process', () => {
    expect(isHandledEvent('installation')).toBe(true);
    expect(isHandledEvent('push')).toBe(true);
    expect(isHandledEvent('pull_request')).toBe(true);
  });

  it('returns false for unknown or unhandled events', () => {
    expect(isHandledEvent('ping')).toBe(false);
    expect(isHandledEvent('star')).toBe(false);
    expect(isHandledEvent('')).toBe(false);
  });
});
