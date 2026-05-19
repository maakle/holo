import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { FileExplorer } from '@/components/file-explorer/file-explorer';

export const dynamic = 'force-dynamic';

export default async function FilesIndexPage() {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const activeOrgId = resolveActiveOrgId(session);

  // Key on activeOrgId so a workspace switch (which triggers router.refresh
  // on the server tree) remounts the client explorer with fresh state instead
  // of leaving the previous workspace's entries cached in useState.
  return <FileExplorer key={activeOrgId} initialPath="/" />;
}
