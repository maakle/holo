import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';

interface Props {
  searchParams: Promise<{
    client_id?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
  }>;
}

export default async function OAuthConsentPage({ searchParams }: Props) {
  const params = await searchParams;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
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

  const code = crypto.randomUUID().replace(/-/g, '');
  const redirectUri = params.redirect_uri ?? client.redirectUris[0] ?? '/';
  const state = params.state ?? '';
  const callbackUrl = `${redirectUri}?code=${code}&state=${encodeURIComponent(state)}`;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ maxWidth: 480, width: '100%', padding: '2rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <h1 style={{ color: 'var(--text)', fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
          Authorize {client.clientName}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
          <strong style={{ color: 'var(--text)' }}>{client.clientName}</strong> wants to connect to your holo context layer.
        </p>
        <div style={{ marginBottom: 24, padding: '12px 16px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8, fontWeight: 500 }}>Permissions requested:</p>
          {client.scopes.map((scope) => (
            <div key={scope} style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4 }}>• {scope}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <a
            href={callbackUrl}
            style={{ flex: 1, display: 'block', textAlign: 'center', padding: '10px', background: 'var(--accent)', color: 'var(--accent-fg)', borderRadius: 6, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}
          >
            Approve
          </a>
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
