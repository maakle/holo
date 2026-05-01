import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { ConnectAgentPanel } from '@/components/connect-agent-panel';

export default async function ConnectAgentPage() {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const holoUrl = process.env['HOLO_PUBLIC_URL']
    ?? process.env['BETTER_AUTH_URL']?.replace(/\/+$/, '')
    ?? 'http://localhost:3000';
  const mcpUrl = `${holoUrl}/mcp`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Connect your agent</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Point any MCP-compatible agent at your holo instance.
        </p>
      </div>
      <ConnectAgentPanel mcpUrl={mcpUrl} />
    </div>
  );
}
