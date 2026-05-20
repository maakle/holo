import { createHash } from 'node:crypto';

/**
 * Deterministic UUIDv5-like key derivation: SHA-1 of the input rendered as a
 * UUID-shaped string. We don't need the full v5 namespace machinery — every
 * caller passes both `kind` (the reference table) and `id` (the row id), and
 * the only contract is "same (kind, id) → same key, different (kind, id) →
 * different key with negligible collision probability."
 *
 * Outputs a 36-char `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` string so the
 * idempotency_key column can index it cleanly and so the value doubles as the
 * Stripe Meter Event `identifier` (Stripe accepts any unique string under
 * 100 chars; we use UUID shape for consistency with the rest of the schema).
 */
export function deriveIdempotencyKey(kind: string, id: string): string {
  const hex = createHash('sha1').update(`${kind}:${id}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    // Set version nibble to 5 to signal this is a deterministic v5-style key.
    '5' + hex.slice(13, 16),
    // Set variant bits to RFC 4122 (10xx).
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') +
      hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}
