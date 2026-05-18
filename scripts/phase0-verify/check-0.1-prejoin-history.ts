/**
 * Phase 0, Check 0.1: Can a Google Chat App read messages posted BEFORE it
 * joined a space?
 *
 * This is the load-bearing assumption for the bot-in-space migration. If the
 * bot cannot see pre-join history, every space loses its corporate memory at
 * the moment of connection — which is the whole point of the migration.
 *
 * Setup (do BEFORE running this script):
 *   1. In your test Workspace, create a new space named e.g. "Holo Verify 0.1"
 *   2. As a HUMAN user, post 3 messages in the space:
 *        "msg 1 before bot"
 *        "msg 2 before bot"
 *        "msg 3 before bot"
 *   3. Wait ~30 seconds so the createTimes are clearly distinct.
 *   4. Add Holo's Chat App to the space via `@HoloApp` mention.
 *   5. As the same user, post one more message: "msg 4 after bot"
 *   6. Copy the space resource name from the URL bar
 *      (looks like spaces/AAAAAAAAAAA — the chunk after /chat/space/).
 *
 * Then run from the repo root:
 *   SA_JSON_PATH=/path/to/sa.json \
 *   SPACE_NAME=spaces/AAAAAAAAAAA \
 *   pnpm phase0:check-0.1
 *
 * Pass criteria: script reports ≥4 messages, with the bot's join time falling
 * between message 3 and message 4 in the timeline.
 * Fail criteria: script reports only 1 message ("msg 4 after bot") or returns
 * 403 PERMISSION_DENIED on the messages.list call.
 */
import { readFileSync } from 'node:fs';
import {
  mintAppAccessToken,
  parseServiceAccountKey,
} from '../../packages/connectors/src/google-shared/service-account';

// App-auth read scopes that require Workspace admin OAuth grant (configured
// via Admin Console → Security → API-Steuerung → App-Zugriff verwalten).
// `chat.bot` alone does not allow messages.list — confirmed via check-0.1b.
const APP_READ_SCOPES = [
  'https://www.googleapis.com/auth/chat.bot',
  'https://www.googleapis.com/auth/chat.app.messages.readonly',
  'https://www.googleapis.com/auth/chat.app.memberships',
  'https://www.googleapis.com/auth/chat.app.spaces',
];

const SA_JSON_PATH = process.env.SA_JSON_PATH;
const SPACE_NAME = process.env.SPACE_NAME;

if (!SA_JSON_PATH || !SPACE_NAME) {
  console.error('Required env vars: SA_JSON_PATH, SPACE_NAME');
  console.error('Example:');
  console.error('  SA_JSON_PATH=~/holo-sa.json SPACE_NAME=spaces/AAA pnpm phase0:check-0.1');
  process.exit(2);
}

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
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText} on ${url}\n${body}`);
  }
  return (await res.json()) as T;
}

async function main(): Promise<void> {
  const saJson = readFileSync(SA_JSON_PATH!, 'utf8');
  const key = parseServiceAccountKey(saJson);
  console.log(`→ Minting app-level access token (no impersonation) for ${key.client_email}…`);
  console.log(`  scopes: ${APP_READ_SCOPES.length} app-auth read scopes`);
  const { accessToken } = await mintAppAccessToken({ key, scopes: APP_READ_SCOPES });
  console.log('  ✓ token minted');

  console.log(`→ Fetching members in ${SPACE_NAME} (incl. apps) to learn bot join time…`);
  // Without filter, members.list defaults to HUMAN-only. Explicitly request BOT
  // memberships too so we can find the calling Chat App's join time.
  const memberships = await chatGet<{ memberships?: ChatMembership[] }>(
    `https://chat.googleapis.com/v1/${SPACE_NAME}/members?pageSize=50&filter=${encodeURIComponent('member.type = "BOT" OR member.type = "HUMAN"')}`,
    accessToken,
  );
  const allMembers = memberships.memberships ?? [];
  const botMemberships = allMembers.filter((m) => m.member?.type === 'BOT');
  console.log(
    `  ✓ ${allMembers.length} member(s) returned (${botMemberships.length} bot, ${
      allMembers.length - botMemberships.length
    } human)`,
  );
  if (botMemberships.length > 0) {
    for (const b of botMemberships) {
      console.log(`     bot: ${b.member?.name} (joined ${b.createTime})`);
    }
  }
  // Best-effort bot join time. If multiple bots, pick the earliest — covers
  // the common case where Holo is the only bot. If zero bots visible, we
  // continue anyway and ask the user to eyeball timestamps.
  const botJoinTime =
    botMemberships.length > 0
      ? new Date(
          [...botMemberships].sort((a, b) => a.createTime.localeCompare(b.createTime))[0]!
            .createTime,
        )
      : null;

  console.log(`\n→ Listing messages in ${SPACE_NAME}…`);
  let list: { messages?: ChatMessage[] };
  try {
    list = await chatGet<{ messages?: ChatMessage[] }>(
      `https://chat.googleapis.com/v1/${SPACE_NAME}/messages?pageSize=50`,
      accessToken,
    );
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`✗ messages.list failed: ${msg}`);
    if (msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
      console.error('');
      console.error('  Likely cause: the service account is not the Chat App that was added');
      console.error('  to this space. The Holo app you @-mentioned in Chat is registered to a');
      console.error('  specific GCP project; the SA used here must be from that same project.');
      console.error('');
      console.error(`  Current SA project: ${SA_JSON_PATH}`);
      console.error('  Fix: download the SA key from the GCP project that hosts the Holo Chat');
      console.error('  App and re-run with SA_JSON_PATH pointing to it.');
    }
    process.exit(1);
  }
  const messages = list.messages ?? [];
  console.log(`  ✓ ${messages.length} message(s) returned`);

  if (messages.length === 0) {
    console.error('✗ Empty messages list. Either no messages posted, or the SA can\'t see them.');
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
  if (botJoinTime) {
    console.log(`  ${botJoinTime.toISOString()}  ← bot joined here`);
  }

  console.log('');
  if (botJoinTime) {
    const preJoinCount = sorted.filter((m) => new Date(m.createTime) < botJoinTime).length;
    if (preJoinCount > 0) {
      console.log(`✓ PASS: ${preJoinCount} pre-join message(s) visible to the bot.`);
      console.log('  → Phase 1+2 architecture stays as planned.');
      process.exit(0);
    }
    console.log('✗ FAIL: 0 pre-join messages visible. Only post-join messages returned.');
    console.log('  → Migration model breaks. Fallback options:');
    console.log('     (a) stay on DWD for historical ingestion');
    console.log('     (b) accept "history only from connect date"');
    console.log('     (c) hybrid: admin scope for one-time pull, bot for ongoing');
    process.exit(1);
  } else {
    console.log('⚠ INDETERMINATE: bot join time unknown (no BOT membership returned).');
    console.log('  Eyeball the timeline above: do messages from BEFORE you added Holo appear?');
    console.log('  → If yes, treat as PASS. If only post-join messages, treat as FAIL.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('\n✗ Script errored:', err.message ?? err);
  if (err.stack) console.error(err.stack.split('\n').slice(1, 5).join('\n'));
  process.exit(1);
});
