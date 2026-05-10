import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

export default async function SlackPersonalConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string }>;
}) {
  const sp = await searchParams;
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Connect Slack (personal)</h1>
        <p className="text-sm text-gray-500">
          holo will use your Slack account to determine which channels you can see
          in retrieval results. Other users in your org are not affected.
        </p>
      </div>

      {sp.success ? (
        <div className="rounded-md border border-green-300 bg-green-50 p-3 text-sm dark:border-green-800 dark:bg-green-950">
          <div className="font-medium text-green-700 dark:text-green-200">
            Connected. Channel subjects synced.
          </div>
        </div>
      ) : null}

      <div>
        <a
          href="/api/connect/slack-personal/start"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md bg-(--accent,#3F47FF) px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Connect Slack
        </a>
      </div>
    </div>
  );
}
