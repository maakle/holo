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
  resolveActiveOrgId(session); // throws on missing org

  return <FileExplorer initialPath="/" />;
}
