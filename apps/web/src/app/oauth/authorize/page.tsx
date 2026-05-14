import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { schema } from '@holo/db';
import { mintAuthCode } from '@holo/oauth-provider';
import { emitAuditEvent } from '@holo/audit';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }>;
}

async function approveAction(formData: FormData) {
  'use server';
  const clientId = formData.get('client_id') as string;
  const redirectUri = formData.get('redirect_uri') as string;
  const state = (formData.get('state') as string) ?? '';
  const codeChallenge = formData.get('code_challenge') as string;
  const codeChallengeMethod = formData.get('code_challenge_method') as string;
  const requestedOrgId = formData.get('organization_id') as string;
  const grantedScopes = formData.getAll('scope').map(String).filter(Boolean);

  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/sign-in');
  }

  if (codeChallengeMethod !== 'S256' || !codeChallenge) {
    redirect('/');
  }

  const sessionUser = session!.user as { id: string };

  // The org_id comes from a form field the user controls — re-verify they
  // are an actual member of it. Otherwise an authenticated user could edit
  // the hidden input in their browser and mint a token scoped to any org.
  if (!requestedOrgId) redirect('/');
  const membership = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, sessionUser.id),
        eq(schema.member.organizationId, requestedOrgId),
      ),
    )
    .limit(1);
  if (!membership[0]) redirect('/');
  const organizationId = membership[0].organizationId;

  // Re-validate granted scopes against what the client actually registered.
  // The checkbox names are user-controllable; without this, a user could
  // POST scopes the client never asked for (or that don't exist).
  const clientRow = await db
    .select({ scopes: schema.oauthClients.scopes })
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1);
  if (!clientRow[0]) redirect('/');
  const allowedScopes = new Set(clientRow[0].scopes);
  const scopes = grantedScopes.filter((s) => allowedScopes.has(s));
  if (scopes.length === 0) redirect('/');

  const code = await mintAuthCode(db, {
    clientId,
    userId: sessionUser.id,
    organizationId,
    redirectUri,
    scopes,
    codeChallenge,
    codeChallengeMethod: 'S256',
  });

  emitAuditEvent({
    db,
    organizationId,
    userId: sessionUser.id,
    eventType: 'oauth.code_authorized',
    resourceType: 'oauth_client',
    resourceId: clientId,
    meta: { scopes, redirectUri },
  });

  redirect(`${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
}

export default async function OAuthConsentPage({ searchParams }: Props) {
  const params = await searchParams;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>,
    ).toString();
    redirect(`/sign-in?next=${encodeURIComponent(`/oauth/authorize?${qs}`)}`);
  }

  const clientId = params.client_id;
  if (!clientId) redirect('/sign-in');

  const clients = await db
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId!))
    .limit(1);

  const client = clients[0];

  if (!client) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 480, width: '100%', padding: '2rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 600 }}>Unknown client</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 14 }}>
            Client ID <code style={{ fontFamily: 'var(--font-mono)' }}>{clientId}</code> is not registered.
          </p>
        </div>
      </div>
    );
  }

  const redirectUri = params.redirect_uri ?? client.redirectUris[0] ?? '/';
  if (params.redirect_uri && !client.redirectUris.includes(params.redirect_uri)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 480, width: '100%', padding: '2rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h1 style={{ color: 'var(--error)', fontSize: 18, fontWeight: 600 }}>Invalid redirect URI</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 14 }}>
            The redirect_uri is not registered for this client.
          </p>
        </div>
      </div>
    );
  }

  let redirectHost = redirectUri;
  try {
    redirectHost = new URL(redirectUri).host;
  } catch {
    // keep raw value
  }

  const sessionUser = session!.user as { id: string };
  const memberships = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
    .where(eq(schema.member.userId, sessionUser.id));

  if (memberships.length === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ maxWidth: 480, width: '100%', padding: '2rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <h1 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 600 }}>No workspace</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 8, fontSize: 14 }}>
            You are not a member of any workspace. Create or join one before authorizing apps.
          </p>
        </div>
      </div>
    );
  }

  let activeOrgId: string;
  try {
    activeOrgId = resolveActiveOrgId(session!);
  } catch {
    activeOrgId = memberships[0]!.id;
  }
  const defaultOrgId = memberships.some((m) => m.id === activeOrgId) ? activeOrgId : memberships[0]!.id;

  const scopeDescriptions: Record<string, string> = {
    search: 'Search your context layer',
    'skills:read': 'Read your skills',
    'skills:write': 'Create and update skills',
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: '2rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        {!client.isVerified && (
          <div
            role="alert"
            style={{
              marginBottom: 16,
              padding: '10px 12px',
              background: 'var(--warning-bg, #3a2a00)',
              border: '1px solid var(--warning, #b07a00)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--warning-fg, #ffd581)',
              lineHeight: 1.4,
            }}
          >
            <strong>⚠ Unverified app.</strong> This client self-registered and
            has not been verified by holo. Anyone can register a client with
            any name. Only approve if you trust the redirect destination
            shown below.
          </div>
        )}
        <h1 style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          Authorize {client.clientName}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>
          <strong style={{ color: 'var(--text)' }}>{client.clientName}</strong> wants to connect to your holo context layer.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 20 }}>
          Tokens will be sent to{' '}
          <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{redirectHost}</code>
        </p>

        <form action={approveAction}>
          <input type="hidden" name="client_id" value={clientId!} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={params.state ?? ''} />
          <input type="hidden" name="code_challenge" value={params.code_challenge ?? ''} />
          <input type="hidden" name="code_challenge_method" value={params.code_challenge_method ?? 'S256'} />

          <div style={{ marginBottom: 20 }}>
            <label
              htmlFor="organization_id"
              style={{
                display: 'block',
                color: 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 8,
              }}
            >
              Workspace
            </label>
            {memberships.length === 1 ? (
              <>
                <input type="hidden" name="organization_id" value={memberships[0]!.id} />
                <div
                  style={{
                    padding: '10px 12px',
                    background: 'var(--surface-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    fontSize: 14,
                    color: 'var(--text)',
                  }}
                >
                  {memberships[0]!.name}
                </div>
              </>
            ) : (
              <>
                <div style={{ position: 'relative' }}>
                  <select
                    id="organization_id"
                    name="organization_id"
                    defaultValue={defaultOrgId}
                    style={{
                      width: '100%',
                      padding: '10px 36px 10px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: 14,
                      color: 'var(--text)',
                      fontFamily: 'inherit',
                      appearance: 'none',
                      WebkitAppearance: 'none',
                      MozAppearance: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {memberships.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role})
                      </option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <path
                      d="M4 6l4 4 4-4"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <p style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 6 }}>
                  {client.clientName} will only see data from the workspace you choose.
                </p>
              </>
            )}
          </div>

          <div style={{ marginBottom: 24 }}>
            <label
              style={{
                display: 'block',
                color: 'var(--text-muted)',
                fontSize: 12,
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginBottom: 8,
              }}
            >
              Information to share
            </label>
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              {client.scopes.map((scope, i) => (
                <label
                  key={scope}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '6px 0',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    defaultChecked
                    style={{ marginTop: 3, accentColor: 'var(--accent)' }}
                  />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {scopeDescriptions[scope] ?? scope}
                    </span>
                    <code
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 11,
                        color: 'var(--text-subtle)',
                      }}
                    >
                      {scope}
                    </code>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="submit"
              style={{
                flex: 1,
                display: 'block',
                textAlign: 'center',
                padding: '10px',
                background: 'var(--accent)',
                color: 'var(--accent-fg)',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Approve
            </button>
            <a
              href="/"
              style={{
                flex: 1,
                display: 'block',
                textAlign: 'center',
                padding: '10px',
                background: 'var(--surface-2)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Deny
            </a>
          </div>
        </form>
      </div>
    </div>
  );
}
