import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';

/**
 * Claim a Google Workspace `customerNumber` for the active org. Inbound
 * Chat events carry `customerNumber` in every payload; the worker resolves
 * it to an org via `google_chat_workspaces`. Without a row here the bot
 * stays silent — this route is how an admin registers their Workspace.
 *
 * `customer_number` is `UNIQUE` at the DB level (a Workspace tenants
 * exactly one org), so a conflict here means another org already claimed
 * it. We surface that as 409 rather than overwriting.
 */
const CUSTOMER_NUMBER_RE = /^C[A-Za-z0-9]{6,16}$/;

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

    let body: { customerNumber?: unknown };
    try {
      body = (await req.json()) as { customerNumber?: unknown };
    } catch {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'request body must be JSON',
        fix: 'POST { "customerNumber": "C0xxxxxxx" }',
      });
    }

    const raw = typeof body.customerNumber === 'string' ? body.customerNumber.trim() : '';
    // Google customer IDs look like `C0xxxxxxx`; accept the alphanumeric
    // tail with or without a leading `customers/` prefix.
    const customerNumber = raw.replace(/^customers\//, '');
    if (!CUSTOMER_NUMBER_RE.test(customerNumber)) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'customerNumber must look like "C0xxxxxxx"',
        fix: 'Copy it from Google Admin Console → Account → Account settings → Customer ID.',
      });
    }

    try {
      await db
        .insert(schema.googleChatWorkspaces)
        .values({ organizationId: orgId, customerNumber })
        .onConflictDoNothing({
          target: schema.googleChatWorkspaces.customerNumber,
        });
    } catch (err) {
      console.error('google-chat-app claim insert failed', err);
      throw holoError({
        code: ErrorCode.HOLO_INTERNAL,
        problem: 'failed to register workspace',
        fix: 'Retry; if it persists check worker logs.',
      });
    }

    // Verify the row landed under THIS org — if onConflictDoNothing fired
    // because another org already owns this customer_number, that's a 409.
    const rows = await db
      .select({ organizationId: schema.googleChatWorkspaces.organizationId })
      .from(schema.googleChatWorkspaces)
      .where(eq(schema.googleChatWorkspaces.customerNumber, customerNumber))
      .limit(1);
    if (!rows[0] || rows[0].organizationId !== orgId) {
      return NextResponse.json(
        {
          problem: 'this Google Workspace is already linked to another Holo org',
          fix: 'Unlink it from the other org first, or contact support.',
        },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, customerNumber });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json({ problem: e.problem, fix: e.fix }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ problem: 'internal error' }, { status: 500 });
  }
}

/**
 * Unclaim — release the Workspace mapping so another org can take it (or
 * so the admin can re-enter the right number after a typo).
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
