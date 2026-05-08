import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerContext } from '@/lib/server-context';
import { ChatPanel } from '@/components/chat-panel';

export default async function ChatPage() {
  const { auth, env } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY);

  return <ChatPanel hasAnthropicKey={hasAnthropicKey} />;
}
