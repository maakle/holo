import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueResync } from '@/lib/sync-queue';

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  is_member: boolean;
  num_members?: number;
}

const CHANNEL_ID_RE = /^[CG][A-Z0-9]{2,}$/;

async function loadAccessToken(
  db: Awaited<ReturnType<typeof getServerContext>>['db'],
  organizationId: string,
  userId: string,
): Promise<string> {
  const rows = await db
    .select({ accessToken: schema.connectorCredentials.accessToken })
    .from(schema.connectorCredentials)
    .where(
      and(
        eq(schema.connectorCredentials.organizationId, organizationId),
        eq(schema.connectorCredentials.userId, userId),
        eq(schema.connectorCredentials.provider, 'slack'),
        eq(schema.connectorCredentials.status, 'active'),
      ),
    )
    .orderBy(desc(schema.connectorCredentials.connectedAt))
    .limit(1);
  const token = rows[0]?.accessToken;
  if (!token) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'Slack is not connected for this user',
      fix: 'Click Connect on the Slack row before picking channels.',
    });
  }
  return token;
}

async function joinPublicChannel(
  token: string,
  channelId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ channel: channelId }).toString(),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  return { ok: json.ok, error: json.error };
}

async function listAllChannels(token: string): Promise<SlackChannel[]> {
  const out: SlackChannel[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const params = new URLSearchParams({
      limit: '200',
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
    });
    if (cursor) params.set('cursor', cursor);
    const res = await fetch(`https://slack.com/api/conversations.list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json()) as {
      ok: boolean;
      error?: string;
      channels?: SlackChannel[];
      response_metadata?: { next_cursor?: string };
    };
    if (!json.ok) {
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Slack conversations.list returned error: ${json.error ?? 'unknown'}`,
        fix: 'Reconnect Slack or verify the bot has channels:read and groups:read scopes.',
      });
    }
    out.push(...(json.channels ?? []));
    cursor = json.response_metadata?.next_cursor || undefined;
    if (pages >= 10) break;
  } while (cursor);
  return out;
}

export async function GET() {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const userId = session.user.id;

    const token = await loadAccessToken(db, orgId, userId);
    const channels = await listAllChannels(token);

    const allowlist = await db
      .select({
        pattern: schema.connectorAllowlists.pattern,
        patternKind: schema.connectorAllowlists.patternKind,
        decision: schema.connectorAllowlists.decision,
      })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'slack'),
        ),
      );

    const includedExact = new Set(
      allowlist
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => r.pattern),
    );

    // Pull bot_not_in_channel warnings from cursor metadata across all Slack
    // sources for this org.
    const slackSources = await db
      .select({ id: schema.sources.id, externalId: schema.sources.externalId })
      .from(schema.sources)
      .where(and(eq(schema.sources.organizationId, orgId), eq(schema.sources.provider, 'slack')));
    const sourceIds = slackSources.map((s) => s.id);
    const teamId = slackSources[0]?.externalId ?? null;
    const botNotInChannel = new Set<string>();
    if (sourceIds.length > 0) {
      const cursors = await db
        .select({
          metadata: schema.connectorCursors.metadata,
        })
        .from(schema.connectorCursors)
        .where(eq(schema.connectorCursors.organizationId, orgId));
      for (const c of cursors) {
        const list = (c.metadata as Record<string, unknown>)['bot_not_in_channel'];
        if (Array.isArray(list)) {
          for (const id of list) {
            if (typeof id === 'string') botNotInChannel.add(id);
          }
        }
      }
    }

    const defaultAll = includedExact.size === 0;

    return NextResponse.json({
      teamId,
      defaultAll,
      channels: channels.map((c) => ({
        id: c.id,
        name: c.name,
        isPrivate: c.is_private,
        isMember: c.is_member,
        memberCount: c.num_members ?? null,
        selected: includedExact.has(c.id),
        botNotInChannel: botNotInChannel.has(c.id),
      })),
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session, defaultOrgId);
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      channels?: string[];
      defaultAll?: boolean;
    };
    const defaultAll = body.defaultAll === true;
    const desired = !defaultAll && Array.isArray(body.channels)
      ? Array.from(new Set(body.channels))
      : [];
    if (!defaultAll && desired.length > 50) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${desired.length} channels (max 50)`,
        fix: 'Select 50 or fewer channels, or use the default-all mode.',
      });
    }
    if (!defaultAll) {
      for (const id of desired) {
        if (typeof id !== 'string' || !CHANNEL_ID_RE.test(id)) {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: `Invalid Slack channel ID '${id}'`,
            fix: 'Channel IDs must look like C012345 or G012345.',
          });
        }
      }
    }

    const existing = await db
      .select({
        id: schema.connectorAllowlists.id,
        pattern: schema.connectorAllowlists.pattern,
        patternKind: schema.connectorAllowlists.patternKind,
        decision: schema.connectorAllowlists.decision,
      })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'slack'),
        ),
      );

    const existingExact = new Map(
      existing
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => [r.pattern, r.id]),
    );

    const desiredSet = new Set(desired);
    const toInsert = defaultAll ? [] : desired.filter((p) => !existingExact.has(p));
    const toDelete = defaultAll
      ? [...existingExact.values()]
      : [...existingExact.entries()]
          .filter(([pattern]) => !desiredSet.has(pattern))
          .map(([, id]) => id);

    for (const id of toDelete) {
      await db
        .delete(schema.connectorAllowlists)
        .where(
          and(
            eq(schema.connectorAllowlists.id, id),
            eq(schema.connectorAllowlists.organizationId, orgId),
          ),
        );
    }

    // Load channel list once — used both for resolving names into the
    // `notes` column (so chips show #general instead of C012ABC) and for
    // the auto-join step below.
    let channelsById: Map<string, SlackChannel> | null = null;
    if (toInsert.length > 0 || defaultAll) {
      const token = await loadAccessToken(db, orgId, userId);
      const all = await listAllChannels(token);
      channelsById = new Map(all.map((c) => [c.id, c]));

      if (toInsert.length > 0) {
        await db.insert(schema.connectorAllowlists).values(
          toInsert.map((pattern) => ({
            organizationId: orgId,
            provider: 'slack',
            pattern,
            patternKind: 'exact_id' as const,
            decision: 'include' as const,
            createdBy: userId,
            notes: channelsById!.get(pattern)?.name ?? null,
          })),
        );
      }
    }

    // Auto-join public channels. For explicit picks: only the newly-added
    // IDs. For default-all: every public channel in the workspace, since the
    // user's intent is "sync everything." Private channels can't be joined
    // by the bot — flag them so the UI can prompt for /invite @holo.
    const joined: string[] = [];
    const needsInvite: { id: string; name: string }[] = [];
    const joinErrors: { id: string; error: string }[] = [];
    const targets: string[] = defaultAll ? [] : toInsert;
    if ((defaultAll || toInsert.length > 0) && channelsById) {
      const token = await loadAccessToken(db, orgId, userId);
      if (defaultAll) {
        for (const c of channelsById.values()) targets.push(c.id);
      }
      for (const id of targets) {
        const c = channelsById.get(id);
        if (!c) continue;
        if (c.is_private) {
          if (!c.is_member) needsInvite.push({ id: c.id, name: c.name });
          continue;
        }
        if (c.is_member) {
          joined.push(id);
          continue;
        }
        const result = await joinPublicChannel(token, id);
        if (result.ok) joined.push(id);
        else joinErrors.push({ id, error: result.error ?? 'unknown' });
      }
    }

    let triggeredSync = false;
    const hasChannelsToSync = defaultAll || desired.length > 0;
    // In default-all mode, trigger sync whenever we joined or surfaced any
    // channels — the allowlist rows don't change but membership does, which
    // is what the worker actually reads.
    const defaultAllChanged = defaultAll && (joined.length > 0 || needsInvite.length > 0);
    if (
      (toInsert.length > 0 || toDelete.length > 0 || defaultAllChanged) &&
      hasChannelsToSync
    ) {
      const sourceRows = await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(
          and(eq(schema.sources.organizationId, orgId), eq(schema.sources.provider, 'slack')),
        );
      for (const s of sourceRows) {
        await enqueueResync('slack', { sourceId: s.id, organizationId: orgId });
        triggeredSync = true;
      }
    }

    return NextResponse.json({
      added: toInsert,
      removed: toDelete.length,
      total: defaultAll ? null : desired.length,
      defaultAll,
      triggeredSync,
      joined,
      needsInvite,
      joinErrors,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
