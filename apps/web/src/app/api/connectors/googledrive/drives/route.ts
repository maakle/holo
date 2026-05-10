import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { ErrorCode, HoloError, holoError } from '@holo/errors';
import {
  loadGoogleServiceAccountToken,
  parseScope,
  MY_DRIVE_ALLOWLIST_KEY,
} from '@holo/connectors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueResync } from '@/lib/sync-queue';

/**
 * Folder/file picker for Google Drive — tree browse + allowlist mutation.
 *
 *   GET                                  → roots + saved scope chips
 *   GET ?folderId=<id>&driveId=<id>      → children of one folder
 *   PUT                                  → save full allowlist (patterns + labels)
 *
 * Pattern grammar lives in @holo/connectors googledrive/scopes — both sides
 * read from there to stay in sync. The wire format here is intentionally
 * close to the spec's parsed shape so the picker can round-trip cleanly.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';
// Drive resource IDs are URL-safe strings. Bounded length keeps a hostile
// client from stuffing arbitrary garbage through validation.
const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

interface SharedDrive {
  id: string;
  name: string;
}

interface DriveFileMini {
  id: string;
  name: string;
  mimeType: string;
  driveId?: string;
}

async function googleFetch(
  accessToken: string,
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`https://www.googleapis.com${path}`);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw holoError({
      code: ErrorCode.HOLO_FETCH_FAILED,
      problem: `Google Drive ${path} returned ${res.status}`,
      cause: text.slice(0, 500),
      fix:
        res.status === 401 || res.status === 403
          ? 'Reconnect Google Drive or re-check the domain-wide delegation scopes.'
          : 'Retry; if it persists, check Google Workspace status.',
    });
  }
  return res.json();
}

async function listAllSharedDrives(accessToken: string): Promise<SharedDrive[]> {
  const out: SharedDrive[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const json = (await googleFetch(accessToken, '/drive/v3/drives', {
      pageSize: '100',
      fields: 'nextPageToken,drives(id,name)',
      ...(pageToken ? { pageToken } : {}),
    })) as { drives?: SharedDrive[]; nextPageToken?: string };
    if (json.drives) out.push(...json.drives);
    pageToken = json.nextPageToken;
    if (pages >= 20) break;
  } while (pageToken);
  return out;
}

async function listFolderChildren(
  accessToken: string,
  folderId: string,
  driveId: string | null,
): Promise<DriveFileMini[]> {
  const out: DriveFileMini[] = [];
  let pageToken: string | undefined;
  let pages = 0;
  do {
    pages += 1;
    const params: Record<string, string> = {
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: '200',
      fields: 'nextPageToken,files(id,name,mimeType,driveId)',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      spaces: 'drive',
      corpora: driveId ? 'drive' : 'user',
    };
    if (driveId) params['driveId'] = driveId;
    if (pageToken) params['pageToken'] = pageToken;
    const json = (await googleFetch(accessToken, '/drive/v3/files', params)) as {
      files?: DriveFileMini[];
      nextPageToken?: string;
    };
    if (json.files) out.push(...json.files);
    pageToken = json.nextPageToken;
    // Bound at 5 pages (1000 entries) for picker responsiveness. Users
    // with mega-folders get truncated lists but can use the parent breadcrumb
    // to drill elsewhere; the spec's recursive walk is not bounded.
    if (pages >= 5) break;
  } while (pageToken);
  return out;
}

async function loadAccessToken(orgId: string, db: Awaited<ReturnType<typeof getServerContext>>['db']) {
  return loadGoogleServiceAccountToken({
    db,
    organizationId: orgId,
    provider: 'googledrive',
  });
}

export async function GET(req: Request) {
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
    const url = new URL(req.url);
    const folderId = url.searchParams.get('folderId');
    const driveId = url.searchParams.get('driveId');

    if (folderId) {
      if (!ID_RE.test(folderId)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Invalid folder id '${folderId}'`,
          fix: 'Browse from the picker — folder ids should be URL-safe strings.',
        });
      }
      if (driveId && !ID_RE.test(driveId)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Invalid drive id '${driveId}'`,
          fix: 'Browse from the picker.',
        });
      }
      const minted = await loadAccessToken(orgId, db);
      const children = await listFolderChildren(
        minted.accessToken,
        folderId,
        driveId,
      );
      return NextResponse.json({
        children: children.map((c) => ({
          kind: c.mimeType === FOLDER_MIME ? 'folder' : 'file',
          id: c.id,
          name: c.name,
          mimeType: c.mimeType,
          driveId: c.driveId ?? null,
        })),
      });
    }

    // Root browse: My Drive + Shared Drives + the user's saved chips.
    const minted = await loadAccessToken(orgId, db);
    const shared = await listAllSharedDrives(minted.accessToken);

    const allowlist = await db
      .select({
        pattern: schema.connectorAllowlists.pattern,
        notes: schema.connectorAllowlists.notes,
        patternKind: schema.connectorAllowlists.patternKind,
        decision: schema.connectorAllowlists.decision,
      })
      .from(schema.connectorAllowlists)
      .where(
        and(
          eq(schema.connectorAllowlists.organizationId, orgId),
          eq(schema.connectorAllowlists.provider, 'googledrive'),
        ),
      );

    const included = allowlist.filter(
      (r) => r.decision === 'include' && r.patternKind === 'exact_id',
    );

    const includedDriveIds = new Set<string>();
    let myDriveSelected = false;
    const savedScopes: Array<{
      pattern: string;
      kind: 'folder' | 'file' | 'drive' | 'mydrive';
      id: string | null;
      label: string;
    }> = [];
    for (const row of included) {
      const parsed = parseScope(row.pattern);
      if (!parsed) continue;
      const label = row.notes?.trim() || row.pattern;
      if (parsed.kind === 'mydrive') {
        myDriveSelected = true;
      } else if (parsed.kind === 'drive' && parsed.id) {
        includedDriveIds.add(parsed.id);
      } else if ((parsed.kind === 'folder' || parsed.kind === 'file') && parsed.id) {
        savedScopes.push({
          pattern: row.pattern,
          kind: parsed.kind,
          id: parsed.id,
          label,
        });
      }
    }

    const defaultAll = included.length === 0;

    return NextResponse.json({
      defaultAll,
      impersonationEmail: minted.impersonationEmail,
      myDrive: {
        key: MY_DRIVE_ALLOWLIST_KEY,
        rootFolderId: 'root',
        label: minted.impersonationEmail
          ? `My Drive (${minted.impersonationEmail})`
          : 'My Drive',
        selected: myDriveSelected,
      },
      sharedDrives: shared.map((d) => ({
        id: d.id,
        name: d.name,
        // Shared Drives use the entire drive as their root folder id when
        // listing children (Drive's API treats the drive id itself as the
        // parent for top-level items).
        rootFolderId: d.id,
        selected: includedDriveIds.has(d.id),
      })),
      savedScopes,
    });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

interface PutItem {
  pattern: string;
  /** Display label for chips / manage sheet. Trusted as display-only. */
  label?: string;
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
      items?: PutItem[];
      defaultAll?: boolean;
    };
    const defaultAll = body.defaultAll === true;
    const items: PutItem[] = defaultAll
      ? []
      : Array.isArray(body.items)
        ? body.items
        : [];

    // Validate + dedupe.
    const seen = new Set<string>();
    const validated: Array<{ pattern: string; label: string | null }> = [];
    for (const item of items) {
      if (!item || typeof item.pattern !== 'string') {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: 'each item must be { pattern: string, label?: string }',
          fix: 'Re-open the picker.',
        });
      }
      const parsed = parseScope(item.pattern);
      if (!parsed) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Invalid Google Drive scope pattern '${item.pattern}'`,
          fix: 'Re-open the picker.',
        });
      }
      if (seen.has(item.pattern)) continue;
      seen.add(item.pattern);
      // Trust label as display-only; clamp length to keep storage bounded.
      const rawLabel = typeof item.label === 'string' ? item.label.trim() : '';
      validated.push({
        pattern: item.pattern,
        label: rawLabel ? rawLabel.slice(0, 240) : null,
      });
    }
    if (validated.length > 200) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Cannot allowlist ${validated.length} items (max 200)`,
        fix: 'Narrow the selection or pick a folder higher in the tree.',
      });
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
          eq(schema.connectorAllowlists.provider, 'googledrive'),
        ),
      );

    const existingExact = new Map(
      existing
        .filter((r) => r.decision === 'include' && r.patternKind === 'exact_id')
        .map((r) => [r.pattern, r.id]),
    );

    const desiredSet = new Set(validated.map((v) => v.pattern));
    const toInsert = defaultAll
      ? []
      : validated.filter((v) => !existingExact.has(v.pattern));
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

    if (toInsert.length > 0) {
      await db.insert(schema.connectorAllowlists).values(
        toInsert.map((v) => ({
          organizationId: orgId,
          provider: 'googledrive',
          pattern: v.pattern,
          patternKind: 'exact_id' as const,
          decision: 'include' as const,
          createdBy: userId,
          notes: v.label,
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
            eq(schema.sources.provider, 'googledrive'),
          ),
        );
      for (const s of sourceRows) {
        await enqueueResync('googledrive', { sourceId: s.id, organizationId: orgId });
        triggeredSync = true;
      }
    }

    return NextResponse.json({
      added: toInsert.map((v) => v.pattern),
      removed: toDelete.length,
      total: defaultAll ? null : validated.length,
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

