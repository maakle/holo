import { describe, it, expect, beforeAll } from 'vitest';
import { encryptToken, decryptToken, generateKey, initCrypto } from '../src/index';
import { MemexError } from '@memex/errors';

describe('crypto', () => {
  beforeAll(async () => {
    await initCrypto();
  });

  it('encrypts and decrypts a roundtrip', () => {
    const key = generateKey();
    const plaintext = 'gho_abcdefghijklmnop1234567890';
    const ct = encryptToken(plaintext, key);
    expect(ct).not.toContain(plaintext);
    expect(decryptToken(ct, key)).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random nonce)', () => {
    const key = generateKey();
    const a = encryptToken('hello', key);
    const b = encryptToken('hello', key);
    expect(a).not.toBe(b);
  });

  it('throws MEMEX_TOKEN_DECRYPT_FAILED with the wrong key', () => {
    const k1 = generateKey();
    const k2 = generateKey();
    const ct = encryptToken('secret', k1);
    expect(() => decryptToken(ct, k2)).toThrow(MemexError);
    try {
      decryptToken(ct, k2);
    } catch (e) {
      expect((e as MemexError).code).toBe('MEMEX_TOKEN_DECRYPT_FAILED');
    }
  });

  it('throws MEMEX_TOKEN_DECRYPT_FAILED on malformed ciphertext', () => {
    const key = generateKey();
    expect(() => decryptToken('not-base64-!@#', key)).toThrow(MemexError);
  });

  it('supports key rotation via re-encryption', () => {
    const oldKey = generateKey();
    const newKey = generateKey();
    const plaintext = 'sensitive-token';
    const ct1 = encryptToken(plaintext, oldKey);
    const decrypted = decryptToken(ct1, oldKey);
    const ct2 = encryptToken(decrypted, newKey);
    expect(decryptToken(ct2, newKey)).toBe(plaintext);
  });
});
