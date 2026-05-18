/**
 * Phase 0, Check 0.1d: User-Context-Auth fallback. Uses DWD-impersonation to
 * mint a user-context token with chat.messages.readonly etc. Same auth pattern
 * as the existing DWD-based read-only connector — known-good path.
 *
 * Purpose: bypass the (currently blocked) app-auth path and answer the
 * load-bearing architectural question: "Does Google Chat's messages.list
 * return pre-join history?" via a deterministic auth method.
 *
 * Prerequisites:
 *   - SA has DWD configured in Workspace Admin Console
 *   - DWD scopes include chat.messages.readonly, chat.spaces.readonly, chat.memberships.readonly
 *     (if not, this script will fail with HOLO_OAUTH_EXCHANGE_FAILED — add them
 *     in admin.google.com → Security → API Controls → Domain-wide Delegation)
 *
 * Run:
 *   SA_JSON_PATH=/path/to/sa.json \
 *   IMPERSONATE_EMAIL=admin@yourdomain.com \
 *   SPACE_NAME=spaces/AAA \
 *   pnpm phase0:check-0.1d
 */
import { readFileSync } from 'node:fs';
import {
  mintDelegatedAccessToken,
  parseServiceAccountKey,
} from '../../packages/connectors/src/google-shared/service-account';

const SA_JSON_PATH = process.env.SA_JSON_PATH;
const IMPERSONATE_EMAIL = process.env.IMPERSONATE_EMAIL;
const SPACE_NAME = process.env.SPACE_NAME;

if (!SA_JSON_PATH || !IMPERSONATE_EMAIL || !SPACE_NAME) {
  console.error('Required env vars: SA_JSON_PATH, IMPERSONATE_EMAIL, SPACE_NAME');
  console.error('Example:');
  console.error(
    '  SA_JSON_PATH=~/holo-sa.json IMPERSONATE_EMAIL=mathias@midlane.com SPACE_NAME=spaces/AAA pnpm phase0:check-0.1d',
  );
  process.exit(2);
}

const USER_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages.readonly',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/chat.memberships.readonly',
];

interface ChatMessage {
  name: string;
  createTime: string;
  text?: string;
  sender?: { name: string; type?: string };
}

interface ChatMembership {
  name: string;
  createTime: string;
  member?: { name: string; type?: string };
}

async function chatGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} on ${url}\n${body}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const saJson = readFileSync(SA_JSON_PATH!, 'utf8');
  const key = parseServiceAccountKey(saJson);

  console.log(`SA:           ${key.client_email}`);
  console.log(`Impersonating: ${IMPERSONATE_EMAIL}`);
  console.log(`Space:        ${SPACE_NAME}\n`);

  console.log('→ Minting user-context token via DWD-impersonation…');
  const { accessToken } = await mintDelegatedAccessToken({
    key,
    impersonationEmail: IMPERSONATE_EMAIL!,
    scopes: USER_SCOPES,
  });
  console.log('  ✓ token minted\n');

  console.log(`→ Fetching members in ${SPACE_NAME} to learn bot join time…`);
  const memberships = await chatGet<{ memberships?: ChatMembership[] }>(
    `https://chat.googleapis.com/v1/${SPACE_NAME}/members?pageSize=50&filter=${encodeURIComponent(
      'member.type = "BOT" OR member.type = "HUMAN"',
    )}`,
    accessToken,
  );
  const all = memberships.memberships ?? [];
  const bots = all.filter((m) => m.member?.type === 'BOT');
  console.log(`  ✓ ${all.length} member(s), ${bots.length} bot(s)`);
  const botJoinTime =
    bots.length > 0
      ? new Date(
          [...bots].sort((a, b) => a.createTime.localeCompare(b.createTime))[0]!.createTime,
        )
      : null;
  if (botJoinTime) console.log(`     bot joined at ${botJoinTime.toISOString()}`);

  console.log(`\n→ Listing messages in ${SPACE_NAME}…`);
  const list = await chatGet<{ messages?: ChatMessage[] }>(
    `https://chat.googleapis.com/v1/${SPACE_NAME}/messages?pageSize=50`,
    accessToken,
  );
  const messages = list.messages ?? [];
  console.log(`  ✓ ${messages.length} message(s) returned`);

  if (messages.length === 0) {
    console.error('✗ Empty messages list.');
    process.exit(1);
  }

  const sorted = [...messages].sort((a, b) => a.createTime.localeCompare(b.createTime));
  console.log('\nTimeline (oldest → newest):');
  for (const m of sorted) {
    const t = new Date(m.createTime);
    const marker = botJoinTime
      ? t < botJoinTime
        ? '  PRE-JOIN '
        : '  post-join'
      : '  (?)      ';
    console.log(`  ${m.createTime}  ${marker}  ${(m.text ?? '<no text>').slice(0, 60)}`);
  }
  if (botJoinTime) console.log(`  ${botJoinTime.toISOString()}  ← bot joined here`);

  console.log('');
  if (botJoinTime) {
    const preJoinCount = sorted.filter((m) => new Date(m.createTime) < botJoinTime).length;
    if (preJoinCount > 0) {
      console.log(`✓ PASS: ${preJoinCount} pre-join message(s) visible via USER-CONTEXT auth.`);
      console.log('  → Architecture is feasible. Auth path may stay app-auth (when Google fixes');
      console.log('    propagation) or user-OAuth-via-Marketplace.');
      process.exit(0);
    }
    console.log('✗ FAIL: 0 pre-join messages visible even via user-context auth.');
    console.log('  → Genuine API limitation — historical reads not possible at all.');
    process.exit(1);
  } else {
    console.log('⚠ Eyeball the timeline above — does it include messages from before you');
    console.log('  added Holo to the space? If yes → architecturally PASS.');
    process.exit(0);
  }
}

main().catch((err) => {
  const msg = (err as Error).message ?? String(err);
  console.error('\n✗ Script errored:', msg);
  if (msg.includes('invalid_grant') || msg.includes('HOLO_OAUTH_EXCHANGE_FAILED')) {
    console.error('\nLikely cause: DWD scopes don\'t include the required user scopes.');
    console.error('Fix: admin.google.com → Security → API Controls → Domain-wide Delegation');
    console.error('Add to the SA\'s scope list:');
    for (const s of USER_SCOPES) console.error(`  ${s}`);
  }
  process.exit(1);
});
