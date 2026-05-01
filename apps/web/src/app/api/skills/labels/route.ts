import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function GET(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const url = new URL(req.url);
    const skillSlug = url.searchParams.get('skillSlug');

    const conditions = [eq(schema.skillLabels.organizationId, orgId)];
    if (skillSlug) conditions.push(eq(schema.skillLabels.skillSlug, skillSlug));

    const rows = await db
      .select({
        id: schema.skillLabels.id,
        sourceArtifactId: schema.skillLabels.sourceArtifactId,
        skillSlug: schema.skillLabels.skillSlug,
        createdAt: schema.skillLabels.createdAt,
      })
      .from(schema.skillLabels)
      .where(and(...conditions));

    return NextResponse.json({ labels: rows });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), { status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400 });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const body = (await req.json().catch(() => null)) as {
      sourceArtifactId?: string;
      skillSlug?: string;
    } | null;
    if (!body?.sourceArtifactId?.trim() || !body?.skillSlug?.trim()) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'sourceArtifactId and skillSlug are required',
        fix: 'Provide both fields.',
      });
    }

    const slug = body.skillSlug.trim().toLowerCase().replace(/\s+/g, '-');

    await db
      .insert(schema.skillLabels)
      .values({
        organizationId: orgId,
        userId,
        sourceArtifactId: body.sourceArtifactId.trim(),
        skillSlug: slug,
      })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      return NextResponse.json(e.toJSON(), { status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400 });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
