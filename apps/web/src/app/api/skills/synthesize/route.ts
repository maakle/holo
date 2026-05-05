import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';
import { synthesizeAndPersist } from '@/lib/synthesize-and-persist';

export async function POST(req: Request) {
  try {
    const { auth, db, defaultOrgId } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({ code: ErrorCode.HOLO_AUTH_NO_SESSION, problem: 'must be signed in', fix: 'Sign in.' });
    }
    const orgId = defaultOrgId;
    const userId = session.user.id;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'ANTHROPIC_API_KEY is not configured',
        fix: 'Add ANTHROPIC_API_KEY to your .env file.',
      });
    }

    const body = (await req.json().catch(() => null)) as { skillSlug?: string } | null;
    if (!body?.skillSlug?.trim()) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'skillSlug is required',
        fix: 'Provide a skillSlug in the request body.',
      });
    }
    const skillSlug = body.skillSlug.trim();

    const { skillId } = await synthesizeAndPersist({ db, orgId, userId, skillSlug, apiKey });

    return NextResponse.json({ ok: true, skillId, slug: skillSlug });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
