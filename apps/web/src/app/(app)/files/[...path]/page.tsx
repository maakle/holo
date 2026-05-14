import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { FileExplorer } from '@/components/file-explorer/file-explorer';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ path: string[] }>;
}

export default async function FilesPathPage({ params }: PageProps) {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  resolveActiveOrgId(session);

  const { path } = await params;
  // Decode each segment — the URL preserves `#` and `?` literals via the
  // catch-all segment, but we still rebuild the canonical path here so
  // bookmarked URLs resolve cleanly.
  const decoded = path.map((p) => decodeURIComponent(p));
  const fullPath = '/' + decoded.join('/');

  return <FileExplorer initialPath={fullPath} />;
}
