import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { ConnectClient } from './connect-client';
import { revokeToken } from './actions';

function deriveBaseUrls(authUrl: string): { mcpUrl: string; restUrl: string } {
  // BETTER_AUTH_URL points at apps/web (default :3030). The MCP / REST surfaces
  // both live on the sibling Hono service (default :8091) — JSON-RPC at /mcp,
  // OpenAPI REST under /v1/*. For self-hosters running both behind a single
  // domain, override these via env.
  try {
    const u = new URL(authUrl);
    const proto = u.protocol;
    const host = u.hostname;
    const port = process.env.MCP_PUBLIC_PORT ?? '8091';
    const base = `${proto}//${host}:${port}`;
    return {
      mcpUrl: `${base}/mcp`,
      restUrl: base,
    };
  } catch {
    return {
      mcpUrl: 'http://localhost:8091/mcp',
      restUrl: 'http://localhost:8091',
    };
  }
}

export default async function ConnectAgentPage() {
  const { auth, db, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/dashboard/connect-agent');

  const sessionUser = session.user as unknown as { id: string; organizationId: string };

  const tokens = await db
    .select({
      id: schema.apiToken.id,
      name: schema.apiToken.name,
      prefix: schema.apiToken.prefix,
      lastUsedAt: schema.apiToken.lastUsedAt,
      createdAt: schema.apiToken.createdAt,
    })
    .from(schema.apiToken)
    .where(
      and(
        eq(schema.apiToken.organizationId, sessionUser.organizationId),
        eq(schema.apiToken.userId, sessionUser.id),
        isNull(schema.apiToken.revokedAt),
      ),
    )
    .orderBy(asc(schema.apiToken.createdAt));

  const { mcpUrl, restUrl } = deriveBaseUrls(env.BETTER_AUTH_URL);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-display text-h1">Connect your agent</h1>
        <p className="mt-1 max-w-[680px] text-body-sm text-text-muted">
          Generate a token, then drop the snippet for your agent into its config. MCP
          clients (Claude Desktop, Cursor, Cline) and REST clients (curl, Python,
          TypeScript) all hit the same backend.
        </p>
      </div>

      <ConnectClient mcpUrl={mcpUrl} restUrl={restUrl} />

      {tokens.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-h3">Active tokens</h2>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-body-sm">
              <thead className="bg-surface-2 text-caption uppercase tracking-[0.06em] text-text-subtle">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Name</th>
                  <th className="px-4 py-3 text-left font-medium">Prefix</th>
                  <th className="px-4 py-3 text-left font-medium">Last used</th>
                  <th className="px-4 py-3 text-left font-medium">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-4 py-3">{t.name}</td>
                    <td className="px-4 py-3 font-mono text-mono text-text-muted">
                      holo_{t.prefix}…
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {t.lastUsedAt
                        ? new Date(t.lastUsedAt).toISOString().slice(0, 10)
                        : 'never'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {new Date(t.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={revokeToken}>
                        <input type="hidden" name="tokenId" value={t.id} />
                        <button
                          type="submit"
                          className="text-body-sm text-text-muted hover:text-error"
                        >
                          Revoke
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-2 border-t border-border pt-8 text-body-sm text-text-subtle">
        <p>
          Tokens authorize agent calls against this workspace&apos;s data only. The MCP
          server-side validation lands with PR #5; until then, treat tokens as a
          forward-compatible scaffold.
        </p>
      </section>
    </div>
  );
}
