import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<Response> {
  const body = await req.formData().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const grantType = body.get('grant_type')?.toString();
  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = body.get('code')?.toString();
  if (!code) return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });

  // v0.2 stub: code is passed through as access token with no verification.
  // WARNING: no code binding, expiry, or PKCE check — do NOT expose to untrusted networks before v0.3.
  return NextResponse.json({
    access_token: `holo_${code}`,
    token_type: 'Bearer',
    expires_in: 86400,
    scope: 'search skills:read',
  });
}
