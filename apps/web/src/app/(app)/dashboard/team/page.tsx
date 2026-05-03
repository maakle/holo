'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Copy, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function TeamPage() {
  const [link, setLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      const res = await fetch('/api/team/invite', { method: 'POST' });
      const data = (await res.json()) as { inviteToken?: string; problem?: string };
      if (!res.ok || !data.inviteToken) {
        toast.error(data.problem ?? 'Failed to generate invite link');
        return;
      }
      setLink(`${window.location.origin}/accept-invite?token=${data.inviteToken}`);
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Invite link copied');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  }

  return (
    <div className="max-w-xl space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Team</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Invite members</h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Generate a one-time link and share it with your colleague. They&apos;ll join your
          organization and see the same connections, skills, and observability.
        </p>
      </header>

      <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
        {link ? (
          <>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2">
              <LinkIcon className="h-3.5 w-3.5 shrink-0 text-text-subtle" />
              <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">
                {link}
              </code>
              <button
                type="button"
                onClick={copy}
                aria-label="Copy invite link"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-subtle hover:bg-surface-2 hover:text-text"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="primary" onClick={copy}>
                <Copy className="h-3.5 w-3.5" />
                Copy link
              </Button>
              <Button type="button" variant="ghost" onClick={generate} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5" />
                {loading ? 'Generating…' : 'New link'}
              </Button>
            </div>
          </>
        ) : (
          <Button type="button" variant="primary" onClick={generate} disabled={loading}>
            <LinkIcon className="h-3.5 w-3.5" />
            {loading ? 'Generating…' : 'Generate invite link'}
          </Button>
        )}
      </div>
    </div>
  );
}
