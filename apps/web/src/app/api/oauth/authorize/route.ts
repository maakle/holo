import { NextResponse } from 'next/server';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const consentUrl = new URL('/oauth/authorize', req.url);
  for (const [k, v] of url.searchParams.entries()) {
    consentUrl.searchParams.set(k, v);
  }
  return NextResponse.redirect(consentUrl);
}
