import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ErrorCode, HoloError, holoError } from '@holo/errors';
import { loadGoogleServiceAccountToken } from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueResync } from '@/lib/sync-queue';

interface ChatSpace {
  name: string;
  displayName?: string;
  spaceType?: 'SPACE_TYPE_UNSPECIFIED' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
}

interface ListSpacesResponse {
  spaces?: ChatSpace[];
  nextPageToken?: string;
}

// Resource name regex: `spaces/<id>` where id is opaque (alphanum + a few
// punctuation chars). Validating the prefix is what matters here — we never
// want to insert an arbitrary user-supplied string as an allowlist pattern.
const SPACE_NAME_RE = /^spaces\/[A-Za-z0-9_-]+$/;

async function listAllSpaces(accessToken: string): Promise<ChatSpace[]> {
  const out: ChatSpace[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const params = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`https://chat.googleapis.com/v1/spaces?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw holoError({
        code: ErrorCode.HOLO_FETCH_FAILED,
        problem: `Google Chat spaces.list returned ${res.status}`,
        cause: text.slice(0, 500),
        fix:
          res.status === 401 || res.status === 403
            ? 'Reconnect Google Chat or re-check the domain-wide delegation scopes.'
            : 'Retry; if it persists, check Google Workspace status.',
      });
    }
    const json = (await res.json()) as ListSpacesResponse;
    if (json.spaces) out.push(...json.spaces);
    pageToken = json.nextPageToken || undefined;
    if (pages >= 20) break;
  } while (pageToken);
  return out;
}

export async function GET() {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    const minted = await loadGoogleServiceAccountToken({
      db,
      organizationId: orgId,
      provider: 'google-chat',
    });

    const spaces = await listAllSpaces(minted.accessToken);

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
          eq(schema.connectorAllowlists.provider, 'google-chat'),
        ),
      );

    const includedExact = new Set(
      allowlist
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => r.pattern),
    );
    const defaultAll = includedExact.size === 0;

    // Surface DMs in the UI but flag them — admins can opt in, but the
    // default-all sync path filters them out (see google-chat spec).
    return NextResponse.json({
      defaultAll,
      spaces: spaces.map((s) => ({
        name: s.name,
        displayName: s.displayName ?? '',
        spaceType: s.spaceType ?? 'SPACE_TYPE_UNSPECIFIED',
        isDirectMessage: s.spaceType === 'DIRECT_MESSAGE',
        selected: includedExact.has(s.name),
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
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const body = (await req.json().catch(() => ({}))) as {
      spaces?: string[];
      defaultAll?: boolean;
    };
    const defaultAll = body.defaultAll === true;
    const desired =
      !defaultAll && Array.isArray(body.spaces)
        ? Array.from(new Set(body.spaces))
        : [];
    if (!defaultAll && desired.length > 50) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${desired.length} spaces (max 50)`,
        fix: 'Select 50 or fewer spaces, or use the default-all mode.',
      });
    }
    if (!defaultAll) {
      for (const name of desired) {
        if (typeof name !== 'string' || !SPACE_NAME_RE.test(name)) {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: `Invalid Google Chat space name '${name}'`,
            fix: 'Space names must look like spaces/AAAA1234.',
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
          eq(schema.connectorAllowlists.provider, 'google-chat'),
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

    // Resolve human-readable space names once when we have insertions —
    // mirrors Slack's pattern. The display name lands in the `notes` column
    // so the manage sheet renders chips like "Engineering" instead of
    // "spaces/AAAA1234".
    if (toInsert.length > 0) {
      const minted = await loadGoogleServiceAccountToken({
        db,
        organizationId: orgId,
        provider: 'google-chat',
      });
      const spaces = await listAllSpaces(minted.accessToken);
      const byName = new Map(spaces.map((s) => [s.name, s]));
      await db.insert(schema.connectorAllowlists).values(
        toInsert.map((pattern) => ({
          organizationId: orgId,
          provider: 'google-chat',
          pattern,
          patternKind: 'exact_id' as const,
          decision: 'include' as const,
          createdBy: userId,
          notes: byName.get(pattern)?.displayName?.trim() || null,
        })),
      );
    }

    let triggeredSync = false;
    if (toInsert.length > 0 || toDelete.length > 0) {
      const sourceRows = await db
        .select({ id: schema.sources.id })
        .from(schema.sources)
        .where(
          and(
            eq(schema.sources.organizationId, orgId),
            eq(schema.sources.provider, 'google-chat'),
          ),
        );
      for (const s of sourceRows) {
        await enqueueResync('google-chat', { sourceId: s.id, organizationId: orgId });
        triggeredSync = true;
      }
    }

    return NextResponse.json({
      added: toInsert,
      removed: toDelete.length,
      total: defaultAll ? null : desired.length,
      defaultAll,
      triggeredSync,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
