import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { HoloError, holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export async function POST(req: Request) {
  try {
    const { auth } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = body.email?.trim();
    if (!email) {
      return NextResponse.json(
        {
          code: 'HOLO_INVALID_INPUT',
          problem: 'email is required',
          fix: 'Provide { email: string } in the request body.',
        },
        { status: 400 },
      );
    }

    // v0.1 stub — token is generated but not persisted.
    // Full invite email + DB persistence comes in v0.2.
    const inviteToken = crypto.randomUUID();

    return NextResponse.json({
      status: 'invite_queued',
      message: `Full invite email in v0.2 — share this link: /accept-invite?token=${inviteToken}`,
      inviteToken,
    });
  } catch (e) {
    if (e instanceof HoloError)
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error' },
      { status: 500 },
    );
  }
}
