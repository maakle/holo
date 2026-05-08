import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { ChatHistoryRail } from '@/components/chat-history-rail';

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const { auth, db, defaultOrgId } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');

  const orgId = resolveActiveOrgId(session, defaultOrgId);
  const conversationRows = await db
    .select({
      id: schema.chatConversations.id,
      title: schema.chatConversations.title,
      updatedAt: schema.chatConversations.updatedAt,
    })
    .from(schema.chatConversations)
    .where(
      and(
        eq(schema.chatConversations.organizationId, orgId),
        eq(schema.chatConversations.userId, session.user.id),
      ),
    )
    .orderBy(desc(schema.chatConversations.updatedAt))
    .limit(100);

  const conversations = conversationRows.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
  }));

  return (
    <div className="flex h-full min-h-0 flex-col gap-6" data-fullwidth data-fullheight>
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
      <div className="flex min-h-0 flex-1 gap-6">
        <ChatHistoryRail conversations={conversations} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
