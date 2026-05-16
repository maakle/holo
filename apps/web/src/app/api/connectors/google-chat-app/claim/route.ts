import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Register a Google Workspace for the active org. The required field is
 * `primaryDomains`: one or more verified email domains the Workspace
 * owns (e.g. `acme.com`, `acme.io`). Inbound Chat events carry
 * `user.email`; the gateway routes the event to this org when the
 * asker's domain matches any element here.
 */
// Per RFC 1035/1123 lite — labels of 1–63 alphanumeric/hyphen, at least
// one dot. We don't need full IDN/punycode handling for v1.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function parseDomains(input: unknown): string[] | null {
  const raw = Array.isArray(input) ? input : [input];
  const cleaned: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') return null;
    const lower = v.trim().toLowerCase();
    if (!lower) continue;
    if (!DOMAIN_RE.test(lower)) return null;
    if (!cleaned.includes(lower)) cleaned.push(lower);
  }
  return cleaned;
}

export async function POST(req: Request) {
  try {
    const { db, auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);

    let body: { primaryDomains?: unknown };
    try {
      body = (await req.json()) as { primaryDomains?: unknown };
    } catch {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'request body must be JSON',
        fix: 'POST { "primaryDomains": ["acme.com"] }',
      });
    }

    const primaryDomains = parseDomains(body.primaryDomains);
    if (!primaryDomains || primaryDomains.length === 0) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'at least one valid email domain is required',
        fix: 'Enter your Workspace primary domain (e.g. "acme.com").',
      });
    }

    // Reject if any of these domains is already claimed by another org.
    // We check explicitly rather than relying on a unique constraint
    // because primary_domains is an array — Postgres can't unique-index
    // overlapping arrays without a trigger.
    for (const domain of primaryDomains) {
      const conflicting = await db
        .select({ organizationId: schema.googleChatWorkspaces.organizationId })
        .from(schema.googleChatWorkspaces)
        .where(
          sql`${schema.googleChatWorkspaces.primaryDomains} @> ARRAY[${domain}]::text[]`,
        )
        .limit(1);
      const owner = conflicting[0]?.organizationId;
      if (owner && owner !== orgId) {
        return NextResponse.json(
          {
            problem: `domain "${domain}" is already linked to another Holo org`,
            fix: 'Unlink it from the other org first, or use a different domain.',
          },
          { status: 409 },
        );
      }
    }

    // Upsert: one row per org. Replace the domain list wholesale on
    // re-register.
    const existing = await db
      .select({ id: schema.googleChatWorkspaces.id })
      .from(schema.googleChatWorkspaces)
      .where(eq(schema.googleChatWorkspaces.organizationId, orgId))
      .limit(1);

    if (existing[0]) {
      await db
        .update(schema.googleChatWorkspaces)
        .set({ primaryDomains })
        .where(eq(schema.googleChatWorkspaces.id, existing[0].id));
    } else {
      await db
        .insert(schema.googleChatWorkspaces)
        .values({ organizationId: orgId, primaryDomains });
    }

    return NextResponse.json({ ok: true, primaryDomains });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

/**
 * Unclaim — release the Workspace mapping so another org can take the
 * domain.
 */
export async function DELETE() {
  try {
    const { db, auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }
    const orgId = resolveActiveOrgId(session);
    await db
      .delete(schema.googleChatWorkspaces)
      .where(eq(schema.googleChatWorkspaces.organizationId, orgId));
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}
