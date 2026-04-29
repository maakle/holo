import { customType } from 'drizzle-orm/pg-core';
import { encryptToken, decryptToken, keyFromBase64 } from '@memex/crypto';

let cachedKey: Uint8Array | undefined;

function getKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const b64 = process.env.MEMEX_TOKEN_ENCRYPTION_KEY;
  if (!b64) throw new Error('MEMEX_TOKEN_ENCRYPTION_KEY not set');
  cachedKey = keyFromBase64(b64);
  return cachedKey;
}

// Drizzle custom type: text in DB, transparently encrypted at INSERT and decrypted at SELECT.
export const encryptedText = customType<{ data: string; driverData: string; notNull: false }>({
  dataType() {
    return 'text';
  },
  toDriver(value: string): string {
    return encryptToken(value, getKey());
  },
  fromDriver(value: string): string {
    return decryptToken(value, getKey());
  },
});
