'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function ChatHistoryRail({
  conversations,
}: {
  conversations: ConversationSummary[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [creating, startCreate] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function newChat() {
    startCreate(() => {
      router.push('/chat');
      router.refresh();
    });
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/chat/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { problem?: string } | null;
        toast.error(body?.problem ?? 'Could not delete conversation.');
        return;
      }
      const onActivePage = pathname === `/chat/${id}`;
      if (onActivePage) {
        router.push('/chat');
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3">
      <button
        type="button"
        onClick={newChat}
        disabled={creating}
        className="flex items-center justify-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-[12px] font-medium text-text transition-colors duration-micro hover:border-border-strong disabled:opacity-50"
      >
        <span aria-hidden className="text-text-muted">+</span>
        New chat
      </button>
      <div className="caption px-1 text-text-subtle">Recent</div>
      {conversations.length === 0 ? (
        <p className="px-1 text-[12px] leading-5 text-text-subtle">
          No conversations yet. Start one below.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {conversations.map((c) => {
            const href = `/chat/${c.id}`;
            const active = pathname === href;
            return (
              <li key={c.id} className="group relative">
                <Link
                  href={href}
                  className={`flex items-center rounded-sm py-1.5 pl-2 pr-9 text-[13px] leading-5 transition-colors duration-micro ${
                    active
                      ? 'bg-surface-2 text-text'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  <span className="truncate">{c.title}</span>
                </Link>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    void deleteConversation(c.id);
                  }}
                  disabled={deletingId === c.id}
                  aria-label={`Delete conversation: ${c.title}`}
                  className="absolute right-1 top-1/2 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm text-text-subtle hover:bg-bg hover:text-text group-hover:inline-flex disabled:opacity-50"
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
