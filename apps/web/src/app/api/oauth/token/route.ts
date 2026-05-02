import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { consumeAuthCode, mintAccessToken } from '@holo/oauth-provider';

export async function POST(req: Request): Promise<Response> {
  const body = await req.formData().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const grantType = body.get('grant_type')?.toString();
  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  const code = body.get('code')?.toString();
  const codeVerifier = body.get('code_verifier')?.toString();
  const redirectUri = body.get('redirect_uri')?.toString();
  const clientId = body.get('client_id')?.toString();

  if (!code || !codeVerifier || !redirectUri || !clientId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const { db } = await getServerContext();

  let consumed;
  try {
    consumed = await consumeAuthCode(db, { code, clientId, redirectUri, codeVerifier });
  } catch {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const { accessToken, expiresAt } = await mintAccessToken(db, {
    clientId: consumed.clientId,
    userId: consumed.userId,
    organizationId: consumed.organizationId,
    scopes: consumed.scopes,
  });

  const expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: consumed.scopes.join(' '),
  });
}
