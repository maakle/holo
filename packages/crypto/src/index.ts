import sodium from 'libsodium-wrappers';
import { memexError, ErrorCode } from '@memex/errors';

let initialized = false;

export async function initCrypto(): Promise<void> {
  if (initialized) return;
  await sodium.ready;
  initialized = true;
}

function ensureInit(): void {
  if (!initialized) {
    throw memexError({
      code: ErrorCode.MEMEX_TOKEN_DECRYPT_FAILED,
      problem: 'crypto not initialized',
      fix: 'Call initCrypto() at app boot before any encrypt/decrypt call.',
    });
  }
}

export function generateKey(): Uint8Array {
  ensureInit();
  return sodium.crypto_secretbox_keygen();
}

export function keyFromBase64(b64: string): Uint8Array {
  ensureInit();
  try {
    const raw = sodium.from_base64(b64, sodium.base64_variants.ORIGINAL);
    if (raw.length !== sodium.crypto_secretbox_KEYBYTES) {
      throw new Error(`expected ${sodium.crypto_secretbox_KEYBYTES} bytes, got ${raw.length}`);
    }
    return raw;
  } catch (e) {
    throw memexError({
      code: ErrorCode.MEMEX_TOKEN_DECRYPT_FAILED,
      problem: 'MEMEX_TOKEN_ENCRYPTION_KEY is not a valid 32-byte base64 string',
      cause: (e as Error).message,
      fix: 'Generate a key with: openssl rand -base64 32',
    });
  }
}

export function encryptToken(plaintext: string, key: Uint8Array): string {
  ensureInit();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  const combined = new Uint8Array(nonce.length + ct.length);
  combined.set(nonce, 0);
  combined.set(ct, nonce.length);
  return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL);
}

export function decryptToken(ciphertext: string, key: Uint8Array): string {
  ensureInit();
  try {
    const combined = sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL);
    const nonceBytes = sodium.crypto_secretbox_NONCEBYTES;
    if (combined.length < nonceBytes + sodium.crypto_secretbox_MACBYTES) {
      throw new Error('ciphertext too short');
    }
    const nonce = combined.slice(0, nonceBytes);
    const ct = combined.slice(nonceBytes);
    const plain = sodium.crypto_secretbox_open_easy(ct, nonce, key);
    return sodium.to_string(plain);
  } catch (e) {
    throw memexError({
      code: ErrorCode.MEMEX_TOKEN_DECRYPT_FAILED,
      problem: 'failed to decrypt token',
      cause: (e as Error).message,
      fix: 'Verify MEMEX_TOKEN_ENCRYPTION_KEY matches the key tokens were encrypted with. If you rotated the key, reconnect each connector.',
    });
  }
}
