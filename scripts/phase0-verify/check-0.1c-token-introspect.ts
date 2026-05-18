/**
 * Phase 0, Check 0.1c: Introspect the minted access token to verify what
 * scopes Google actually grants for our SA + scope request, and what user/app
 * principal is on the token.
 *
 * The token endpoint at tokeninfo returns:
 *   - granted scopes (vs. what we requested)
 *   - audience (project number)
 *   - issued_to (client id)
 *
 * Useful for confirming that chat.app.* scopes survived the token mint, vs.
 * being silently dropped because they're not granted on the SA/app yet.
 *
 * Run:
 *   SA_JSON_PATH=/path/to/sa.json pnpm phase0:check-0.1c
 */
import { readFileSync } from 'node:fs';
import {
  mintAppAccessToken,
  parseServiceAccountKey,
} from '../../packages/connectors/src/google-shared/service-account';

const SA_JSON_PATH = process.env.SA_JSON_PATH;
if (!SA_JSON_PATH) {
  console.error('Required env vars: SA_JSON_PATH');
  process.exit(2);
}

const REQUEST_SCOPES = [
  'https://www.googleapis.com/auth/chat.bot',
  'https://www.googleapis.com/auth/chat.app.messages.readonly',
  'https://www.googleapis.com/auth/chat.app.memberships',
  'https://www.googleapis.com/auth/chat.app.spaces',
];

async function main(): Promise<void> {
  const saJson = readFileSync(SA_JSON_PATH!, 'utf8');
  const key = parseServiceAccountKey(saJson);
  console.log(`SA email:    ${key.client_email}`);
  console.log(`SA client_id: ${key.client_id}`);
  console.log(`Project:     ${key.project_id}`);
  console.log(`Requesting ${REQUEST_SCOPES.length} scopes:`);
  for (const s of REQUEST_SCOPES) console.log(`  - ${s}`);
  console.log('');

  const minted = await mintAppAccessToken({ key, scopes: REQUEST_SCOPES });
  console.log(`Token minted (first 30 chars): ${minted.accessToken.slice(0, 30)}…`);
  console.log(`Token expires at: ${minted.expiresAt.toISOString()}\n`);

  console.log('→ Introspecting via Google tokeninfo endpoint…');
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${minted.accessToken}`,
  );
  const body = await res.text();
  if (!res.ok) {
    console.error(`✗ tokeninfo failed: ${res.status}\n${body}`);
    process.exit(1);
  }
  const json = JSON.parse(body) as {
    aud?: string;
    azp?: string;
    email?: string;
    scope?: string;
    expires_in?: string;
  };
  console.log(`  ✓ token is valid`);
  console.log(`  aud (audience):   ${json.aud}`);
  console.log(`  azp (authorized): ${json.azp}`);
  console.log(`  email:            ${json.email}`);
  console.log(`  expires_in:       ${json.expires_in}s`);
  console.log(`  granted scopes:`);
  const grantedScopes = (json.scope ?? '').split(' ').filter(Boolean);
  for (const s of grantedScopes) console.log(`    ✓ ${s}`);

  console.log('');
  const missing = REQUEST_SCOPES.filter((s) => !grantedScopes.includes(s));
  if (missing.length === 0) {
    console.log('✓ All requested scopes are in the token.');
    console.log('  If messages.list still returns ACCESS_TOKEN_SCOPE_INSUFFICIENT,');
    console.log('  the issue is on the admin-grant side, not the token side.');
  } else {
    console.log('✗ Some requested scopes were DROPPED by the token endpoint:');
    for (const s of missing) console.log(`    ✗ ${s}`);
    console.log('  This means the SA itself cannot mint tokens for these scopes,');
    console.log('  separate from any admin grant. Check SA configuration or scope eligibility.');
  }
}

main().catch((err) => {
  console.error('\n✗ Script errored:', err.message ?? err);
  process.exit(1);
});
