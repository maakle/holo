import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { webhookHmac } from '../src/webhooks/hmac';

describe('webhookHmac', () => {
  it('verifies a GitHub-style sha256=hex signature', () => {
    const secret = 'wh_secret';
    const body = '{"action":"opened"}';
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    const verifier = webhookHmac({
      headerName: 'X-Hub-Signature-256',
      algo: 'sha256',
      prefix: 'sha256=',
    });
    expect(
      verifier.verify(
        { rawBody: body, headers: { 'X-Hub-Signature-256': sig } },
        secret,
      ),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = 'wh';
    const sig = 'sha256=' + createHmac('sha256', secret).update('original').digest('hex');
    const verifier = webhookHmac({
      headerName: 'X-Sig',
      algo: 'sha256',
      prefix: 'sha256=',
    });
    expect(
      verifier.verify({ rawBody: 'tampered', headers: { 'X-Sig': sig } }, secret),
    ).toBe(false);
  });

  it('rejects when prefix is missing', () => {
    const verifier = webhookHmac({
      headerName: 'X-Sig',
      algo: 'sha256',
      prefix: 'sha256=',
    });
    expect(verifier.verify({ rawBody: 'b', headers: { 'X-Sig': 'abc' } }, 's')).toBe(false);
  });

  it('verifies Slack-style timestamp+body schema', () => {
    const secret = 's';
    const body = 'token=foo&team_id=T1';
    const ts = '1735000000';
    const expected = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
    const verifier = webhookHmac({
      headerName: 'X-Slack-Signature',
      algo: 'sha256',
      prefix: 'v0=',
      timestampHeader: 'X-Slack-Request-Timestamp',
      replayWindowSeconds: 300,
      now: () => 1735000060_000, // 60s after ts; within window
    });
    expect(
      verifier.verify(
        {
          rawBody: body,
          headers: {
            'X-Slack-Signature': 'v0=' + expected,
            'X-Slack-Request-Timestamp': ts,
          },
        },
        secret,
      ),
    ).toBe(true);
  });

  it('rejects timestamps outside the replay window', () => {
    const secret = 's';
    const body = 'b';
    const ts = '1735000000';
    const expected = createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex');
    const verifier = webhookHmac({
      headerName: 'X-Sig',
      algo: 'sha256',
      prefix: 'v0=',
      timestampHeader: 'X-Ts',
      replayWindowSeconds: 60,
      now: () => 1735000061_000 + 60_000, // > 60s after ts
    });
    expect(
      verifier.verify(
        { rawBody: body, headers: { 'X-Sig': 'v0=' + expected, 'X-Ts': ts } },
        secret,
      ),
    ).toBe(false);
  });

  it('returns false when signature header is missing', () => {
    const verifier = webhookHmac({ headerName: 'X-Sig', algo: 'sha256' });
    expect(verifier.verify({ rawBody: 'b', headers: {} }, 's')).toBe(false);
  });
});
