import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/server-context';

// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// Served from the dashboard origin so MCP clients (Claude, Cursor) can
// complete the discovery chain that begins at the gateway's
// /.well-known/oauth-protected-resource.
export async function GET() {
  const { env } = await getServerContext();
  const issuer = (env.WEB_PUBLIC_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['search', 'skills:read', 'skills:write'],
  });
}
