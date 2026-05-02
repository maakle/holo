import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  if (!codeChallenge) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'code_challenge is required (PKCE)' },
      { status: 400 },
    );
  }

  if (codeChallengeMethod !== 'S256') {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'code_challenge_method must be S256' },
      { status: 400 },
    );
  }

  const { db } = await getServerContext();
  const clients = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1);

  const client = clients[0];
  if (!client) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  if (!client.redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  const consentUrl = new URL('/oauth/authorize', req.url);
  for (const [k, v] of url.searchParams.entries()) {
    consentUrl.searchParams.set(k, v);
  }
  return NextResponse.redirect(consentUrl);
}
