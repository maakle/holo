import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ApiTokens } from '../api-tokens';

export const dynamic = 'force-dynamic';

export default async function SettingsApiKeysPage() {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in?callbackURL=/settings/api-keys');

  const orgId = resolveActiveOrgId(session);
  if (!orgId) redirect('/dashboard');

  return <ApiTokens />;
}
