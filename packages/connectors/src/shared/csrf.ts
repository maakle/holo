import { randomBytes } from 'node:crypto';

export const CSRF_COOKIE_NAME = 'memex-connector-csrf';

export function generateCsrfNonce(): string {
  return randomBytes(16).toString('hex');
}

export function csrfCookieValue(nonce: string): string {
  return `${CSRF_COOKIE_NAME}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
}
