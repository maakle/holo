import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
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
  const scopes = ((formData.get('scopes') as string) ?? '').split(' ').filter(Boolean);

  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect('/sign-in');
  }

  if (codeChallengeMethod !== 'S256' || !codeChallenge) {
    // Should never happen — the authorize route validates before redirect.
    redirect('/');
  }

  const sessionUser = session!.user as { id: string; organizationId?: string };
  let organizationId = sessionUser.organizationId;
  if (!organizationId) {
    const rows = await db
      .select({ organizationId: schema.user.organizationId })
      .from(schema.user)
      .where(eq(schema.user.id, sessionUser.id))
      .limit(1);
    if (!rows[0]) redirect('/sign-in');
    organizationId = rows[0]!.organizationId;
  }

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

  // Show the redirect host alongside the client name so a user noticing
  // "Authorize GitHub" → redirect to attacker.example can spot the
  // mismatch. Falls back to the raw URI if it doesn't parse.
  let redirectHost = redirectUri;
  try {
    redirectHost = new URL(redirectUri).host;
  } catch {
    // keep the raw value
  }

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
        <div style={{ marginBottom: 24, padding: '12px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>Permissions requested:</p>
          {client.scopes.map((scope) => (
            <div key={scope} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>• {scope}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <form action={approveAction} style={{ flex: 1 }}>
            <input type="hidden" name="client_id" value={clientId!} />
            <input type="hidden" name="redirect_uri" value={redirectUri} />
            <input type="hidden" name="state" value={params.state ?? ''} />
            <input type="hidden" name="code_challenge" value={params.code_challenge ?? ''} />
            <input type="hidden" name="code_challenge_method" value={params.code_challenge_method ?? 'S256'} />
            <input type="hidden" name="scopes" value={client.scopes.join(' ')} />
            <button
              type="submit"
              style={{ width: '100%', display: 'block', textAlign: 'center', padding: '10px', background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: 6, fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              Approve
            </button>
          </form>
          <a
            href="/"
            style={{ flex: 1, display: 'block', textAlign: 'center', padding: '10px', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
          >
            Deny
          </a>
        </div>
      </div>
    </div>
  );
}
