import { eq, and } from 'drizzle-orm';
import { schema, type DB } from '@holo/db';
import {
  createSlackApiClient,
  type SlackApiClient,
  type SlackBlock,
} from '@holo/connectors';
import { search, type SearchResult } from '@holo/retrieval-core';

export type SlackBotJob =
  | {
      kind: 'app_mention';
      teamId: string;
      channel: string;
      threadTs: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'message_im';
      teamId: string;
      channel: string;
      threadTs?: string;
      asker: string;
      text: string;
    }
  | {
      kind: 'slash_command';
      teamId: string;
      channel: string;
      asker: string;
      text: string;
      responseUrl: string;
    };

interface WorkspaceCreds {
  organizationId: string;
  accessToken: string;
}

/**
 * Resolve which workspace this Slack team_id maps to. We trust whichever
 * connectorCredentials row was registered with this team — the install path
 * upserts a `sources` row keyed by team_id, and connectorCredentials is
 * already scoped per (org, provider). Multiple users in one org could each
 * own a credentials row, but they all hold tokens for the same workspace, so
 * any of them works for outbound posting; we pick the most recently
 * refreshed one to maximize the chance the token is still valid.
 */
async function resolveWorkspace(db: DB, teamId: string): Promise<WorkspaceCreds | null> {
  const sourceRow = await db
    .select({ organizationId: schema.sources.organizationId })
    .from(schema.sources)
    .where(
      and(eq(schema.sources.provider, 'slack'), eq(schema.sources.externalId, teamId)),
    )
    .limit(1);
  if (!sourceRow[0]) return null;
  const orgId = sourceRow[0].organizationId;

  const credRows = await db
    .select({
      accessToken: schema.connectorCredentials.accessToken,
      lastRefreshedAt: schema.connectorCredentials.lastRefreshedAt,
      connectedAt: schema.connectorCredentials.connectedAt,
    })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, orgId),
        eq(schema.connectorCredentials.provider, 'slack'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    );
  const validRows = credRows.filter((r): r is typeof r & { accessToken: string } =>
    typeof r.accessToken === 'string' && r.accessToken.length > 0,
  );
  if (validRows.length === 0) return null;

  // Sort: most recently refreshed first; fall back to connectedAt.
  validRows.sort((a, b) => {
    const ta = (a.lastRefreshedAt ?? a.connectedAt).getTime();
    const tb = (b.lastRefreshedAt ?? b.connectedAt).getTime();
    return tb - ta;
  });
  const top = validRows[0];
  if (!top) return null;
  return { organizationId: orgId, accessToken: top.accessToken };
}

/**
 * Strip a leading `<@UXXX>` mention so the search query is the user's actual
 * question, not our own bot ID. Slack puts the mention at the start of the
 * text for `app_mention` events.
 */
function cleanQuery(text: string): string {
  return text.replace(/^\s*<@[^>]+>\s*/, '').trim();
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function buildAnswerBlocks(query: string, results: SearchResult[]): SlackBlock[] {
  if (results.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `No results for *${truncate(query, 120)}*. Try rephrasing or check that the source you're looking for is connected.`,
        },
      },
    ];
  }

  const blocks: SlackBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Top results for* _${truncate(query, 120)}_`,
      },
    },
    { type: 'divider' },
  ];

  // Cap at 3 in-line results — Slack message size limits get hairy fast and
  // long block lists are unreadable.
  for (const r of results.slice(0, 3)) {
    const provider = r.source.provider;
    const kind = r.source.artifactKind;
    const snippet = truncate(r.content.replace(/\s+/g, ' '), 280);
    const headerParts = [`*${provider}*`, `_${kind}_`];
    if (r.snippetUrl) {
      headerParts.push(`<${r.snippetUrl}|view>`);
    }
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${headerParts.join(' · ')}\n${snippet}`,
      },
    });
  }

  return blocks;
}

const PLACEHOLDER_TEXT = '_holo is thinking…_';

async function answerInChannel(args: {
  client: SlackApiClient;
  channel: string;
  threadTs?: string;
  query: string;
  results: SearchResult[];
}): Promise<void> {
  const placeholder = await args.client.chatPostMessage({
    channel: args.channel,
    text: PLACEHOLDER_TEXT,
    thread_ts: args.threadTs,
  });

  const blocks = buildAnswerBlocks(args.query, args.results);
  const fallback =
    args.results[0] === undefined
      ? `No results for ${args.query}`
      : `Top result: ${truncate(args.results[0].content, 200)}`;

  if (placeholder.ok && placeholder.ts && placeholder.channel) {
    await args.client.chatUpdate({
      channel: placeholder.channel,
      ts: placeholder.ts,
      text: fallback,
      blocks,
    });
    return;
  }
  // Placeholder failed (rate limit, missing scope, etc.) — try a single
  // direct post as a fallback so the user isn't left hanging.
  await args.client.chatPostMessage({
    channel: args.channel,
    thread_ts: args.threadTs,
    text: fallback,
    blocks,
  });
}

async function postSlashResponse(args: {
  responseUrl: string;
  inChannel: boolean;
  query: string;
  results: SearchResult[];
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const blocks = buildAnswerBlocks(args.query, args.results);
  const fallback =
    args.results[0] === undefined
      ? `No results for ${args.query}`
      : `Top result: ${truncate(args.results[0].content, 200)}`;
  await fetchImpl(args.responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      response_type: args.inChannel ? 'in_channel' : 'ephemeral',
      replace_original: true,
      text: fallback,
      blocks,
    }),
  });
}

export interface SlackBotHandlerDeps {
  db: DB;
  fetchImpl?: typeof fetch;
  /**
   * Override search for tests. Receives the same shape as @holo/retrieval-core
   * search() and returns results.
   */
  searchImpl?: typeof search;
}

export async function handleSlackBotJob(
  job: SlackBotJob,
  deps: SlackBotHandlerDeps,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const workspace = await resolveWorkspace(deps.db, job.teamId);
  if (!workspace) {
    return { ok: false, reason: 'workspace_not_connected' };
  }

  const client = createSlackApiClient(workspace.accessToken, deps.fetchImpl);
  const searchFn = deps.searchImpl ?? search;

  // Per-workspace ACL: bot answers using the workspace's full corpus
  // (subject `org:<id>`). No per-user filtering — confirmed product decision.
  const userSubjects = [`org:${workspace.organizationId}`];

  if (job.kind === 'slash_command') {
    const trimmed = job.text.trim();
    const isPublic = trimmed.startsWith('--public ') || trimmed === '--public';
    const query = isPublic ? trimmed.replace(/^--public\s*/, '') : trimmed;
    if (!query) {
      await postSlashResponse({
        responseUrl: job.responseUrl,
        inChannel: false,
        query: '',
        results: [],
        fetchImpl: deps.fetchImpl,
      });
      return { ok: true };
    }
    const results = await searchFn({
      db: deps.db,
      organizationId: workspace.organizationId,
      q: query,
      topK: 5,
      userSubjects,
    });
    await postSlashResponse({
      responseUrl: job.responseUrl,
      inChannel: isPublic,
      query,
      results,
      fetchImpl: deps.fetchImpl,
    });
    return { ok: true };
  }

  const query = cleanQuery(job.text);
  if (!query) {
    await client.chatPostMessage({
      channel: job.channel,
      thread_ts: 'threadTs' in job ? job.threadTs : undefined,
      text: 'Ask me a question — e.g. `@holo what do we know about onboarding?`',
    });
    return { ok: true };
  }

  const results = await searchFn({
    db: deps.db,
    organizationId: workspace.organizationId,
    q: query,
    topK: 5,
    userSubjects,
  });

  await answerInChannel({
    client,
    channel: job.channel,
    threadTs: 'threadTs' in job ? job.threadTs : undefined,
    query,
    results,
  });

  return { ok: true };
}
