import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { ConnectAgentPanel } from '@/components/connect-agent-panel';

export default async function ConnectAgentPage() {
  const { auth } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const mcpBase = process.env['MCP_PUBLIC_URL']?.replace(/\/+$/, '')
    ?? 'http://localhost:8080';
  const mcpUrl = `${mcpBase}/mcp`;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Connect agent</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Point your agent at holo
        </h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          holo speaks the Model Context Protocol. Drop the URL below into any MCP-compatible
          client to authenticate and start retrieving context.
        </p>
      </header>
      <ConnectAgentPanel mcpUrl={mcpUrl} />
    </div>
  );
}
