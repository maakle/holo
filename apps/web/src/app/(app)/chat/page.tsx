import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { ChatPanel } from '@/components/chat-panel';

export default async function ChatPage() {
  const { auth, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);

  return (
    <div className="space-y-8" data-fullwidth>
      <header className="flex flex-col gap-2">
        <span className="caption">Chat</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Talk to the holo agent
        </h1>
        <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
          Test the holo agent against your indexed content without leaving the dashboard.
          The agent has read-only tools to <span className="font-mono text-text">search</span>{' '}
          your sources and inspect <span className="font-mono text-text">skills</span>; for
          the full MCP surface (artifact fetchers, skill execution, custom tools) point a
          real client at the gateway from{' '}
          <a href="/connect-agent" className="text-accent hover:underline">
            Connect agent
          </a>
          .
        </p>
      </header>
      <ChatPanel hasAnthropicKey={hasAnthropicKey} />
    </div>
  );
}
