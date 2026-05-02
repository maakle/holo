import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { z } from 'zod';

const registrationSchema = z.object({
  client_name: z.string().min(1).max(100),
  redirect_uris: z.array(z.string().url()).min(1).max(5),
  scope: z.string().optional().default('search skills:read'),
  token_endpoint_auth_method: z.string().optional().default('none'),
  grant_types: z.array(z.string()).optional().default(['authorization_code']),
  response_types: z.array(z.string()).optional().default(['code']),
});

export async function POST(req: Request): Promise<Response> {
  const { db, auth } = await getServerContext();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Sign in to register an OAuth client.' },
      { status: 401 },
    );
  }

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

  // Resolve organizationId from session.user; fall back to DB lookup if the
  // additionalFields surface isn't carried through the typed session.
  const sessionUser = session.user as { id: string; organizationId?: string };
  let organizationId = sessionUser.organizationId;
  if (!organizationId) {
    const rows = await db
      .select({ organizationId: schema.user.organizationId })
      .from(schema.user)
      .where(eq(schema.user.id, sessionUser.id))
      .limit(1);
    if (!rows[0]) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    organizationId = rows[0].organizationId;
  }

  const clientId = `holo_client_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const scopes = parsed.data.scope.split(' ').filter(Boolean);

  await db.insert(schema.oauthClients).values({
    organizationId,
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
