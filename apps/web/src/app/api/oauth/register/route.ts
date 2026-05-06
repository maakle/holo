import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { z } from 'zod';

const registrationSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.url()).min(1).max(5),
  scope: z.string().optional().default('search skills:read'),
  token_endpoint_auth_method: z.string().optional().default('none'),
  grant_types: z.array(z.string()).optional().default(['authorization_code']),
  response_types: z.array(z.string()).optional().default(['code']),
});

// RFC 7591 Dynamic Client Registration — unauthenticated.
// MCP clients (Claude, Cursor) discover this endpoint via
// /.well-known/oauth-authorization-server and self-register at "Connect" time.
// The client row is org-less until a user signs in at /oauth/authorize and
// approves; auth codes and access tokens carry the per-grant user+org binding.
export async function POST(req: Request): Promise<Response> {
  const { db } = await getServerContext();

  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 });
  }

  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_client_metadata', error_description: parsed.error.message },
      { status: 400 },
    );
  }

  const clientId = `holo_client_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const scopes = parsed.data.scope.split(' ').filter(Boolean);

  await db.insert(schema.oauthClients).values({
    clientId,
    clientName: parsed.data.client_name,
    redirectUris: parsed.data.redirect_uris,
    scopes,
  });

  return NextResponse.json(
    {
      client_id: clientId,
      client_name: parsed.data.client_name,
      redirect_uris: parsed.data.redirect_uris,
      scope: scopes.join(' '),
      grant_types: parsed.data.grant_types,
      response_types: parsed.data.response_types,
      token_endpoint_auth_method: 'none',
    },
    { status: 201 },
  );
}
