import { describe, it, expect } from 'vitest';
import { signState, verifyState } from '../src/shared/state-jwt';
import { MemexError } from '@memex/errors';

const SECRET = 'a'.repeat(64);

describe('state JWT', () => {
  it('roundtrips claims', async () => {
    const claims = {
      user_id: 'u1',
      organization_id: 'o1',
      csrf_nonce: 'nonce',
      provider: 'github',
    };
    const token = await signState(claims, SECRET);
    const verified = await verifyState(token, SECRET);
    expect(verified).toEqual(claims);
  });

  it('rejects tampering (different secret)', async () => {
    const token = await signState(
      { user_id: 'u', organization_id: 'o', csrf_nonce: 'n', provider: 'github' },
      SECRET,
    );
    await expect(verifyState(token, 'b'.repeat(64))).rejects.toThrow(MemexError);
  });

  it('rejects malformed token', async () => {
    await expect(verifyState('not.a.jwt', SECRET)).rejects.toThrow(MemexError);
  });
});
