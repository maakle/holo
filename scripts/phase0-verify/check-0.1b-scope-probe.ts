/**
 * Phase 0, Check 0.1b: Scope probe — which Chat API scopes work with app-level
 * (service account) authentication for reading messages?
 *
 * Our first attempt with `chat.bot` failed with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
 * Before pivoting the architecture, try every Chat read-related scope to see
 * which (if any) Google accepts for app-auth and which lets messages.list succeed.
 *
 * Run:
 *   SA_JSON_PATH=/path/to/sa.json \
 *   SPACE_NAME=spaces/AAA \
 *   pnpm phase0:check-0.1b
 */
import { readFileSync } from 'node:fs';
import {
  mintAppAccessToken,
  parseServiceAccountKey,
} from '../../packages/connectors/src/google-shared/service-account';

const SA_JSON_PATH = process.env.SA_JSON_PATH;
const SPACE_NAME = process.env.SPACE_NAME;

if (!SA_JSON_PATH || !SPACE_NAME) {
  console.error('Required env vars: SA_JSON_PATH, SPACE_NAME');
  process.exit(2);
}

// Every scope plausibly related to reading Chat messages as an app.
// Some of these are user-context only; we'll find out empirically.
const SCOPE_VARIANTS: { label: string; scopes: string[] }[] = [
  { label: 'chat.bot (current)', scopes: ['https://www.googleapis.com/auth/chat.bot'] },
  {
    label: 'chat.bot + chat.messages.readonly',
    scopes: [
      'https://www.googleapis.com/auth/chat.bot',
      'https://www.googleapis.com/auth/chat.messages.readonly',
    ],
  },
  {
    label: 'chat.messages.readonly only',
    scopes: ['https://www.googleapis.com/auth/chat.messages.readonly'],
  },
  {
    label: 'chat.app.messages.readonly (rumored)',
    scopes: ['https://www.googleapis.com/auth/chat.app.messages.readonly'],
  },
  {
    label: 'chat.app.spaces',
    scopes: ['https://www.googleapis.com/auth/chat.app.spaces'],
  },
  {
    label: 'chat.app.memberships',
    scopes: ['https://www.googleapis.com/auth/chat.app.memberships'],
  },
  {
    label: 'chat.messages (broad)',
    scopes: ['https://www.googleapis.com/auth/chat.messages'],
  },
  {
    label: 'chat.spaces.readonly',
    scopes: ['https://www.googleapis.com/auth/chat.spaces.readonly'],
  },
];

async function tryListMessages(token: string): Promise<{ ok: boolean; detail: string }> {
  const res = await fetch(
    `https://chat.googleapis.com/v1/${SPACE_NAME}/messages?pageSize=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = await res.text();
  if (res.ok) {
    try {
      const json = JSON.parse(body) as { messages?: unknown[] };
      return { ok: true, detail: `${json.messages?.length ?? 0} message(s)` };
    } catch {
      return { ok: true, detail: 'parse error' };
    }
  }
  // Extract just the status reason from the error body for compactness.
  try {
    const json = JSON.parse(body) as { error?: { status?: string; message?: string } };
    return { ok: false, detail: `${res.status} ${json.error?.status ?? '?'}: ${json.error?.message ?? '?'}` };
  } catch {
    return { ok: false, detail: `${res.status} ${body.slice(0, 100)}` };
  }
}

async function main(): Promise<void> {
  const saJson = readFileSync(SA_JSON_PATH!, 'utf8');
  const key = parseServiceAccountKey(saJson);

  console.log(`SA: ${key.client_email}`);
  console.log(`Project: ${key.project_id}`);
  console.log(`Space:   ${SPACE_NAME}\n`);

  for (const variant of SCOPE_VARIANTS) {
    process.stdout.write(`[${variant.label.padEnd(45)}] `);
    let token: string;
    try {
      const minted = await mintAppAccessToken({ key, scopes: variant.scopes });
      token = minted.accessToken;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`✗ token mint failed: ${msg.slice(0, 80)}`);
      continue;
    }
    process.stdout.write('token ✓ ');
    const result = await tryListMessages(token);
    console.log(result.ok ? `messages ✓ (${result.detail})` : `messages ✗ ${result.detail}`);
  }

  console.log('\nLook for the first row that shows BOTH "token ✓" AND "messages ✓".');
  console.log('That scope set is what bot-in-space ingestion needs.');
}

main().catch((err) => {
  console.error('\n✗ Script errored:', err.message ?? err);
  process.exit(1);
});
