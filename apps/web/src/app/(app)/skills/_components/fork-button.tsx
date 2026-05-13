'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function ForkButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [suffix, setSuffix] = useState('');
  const router = useRouter();

  async function submit() {
    const trimmed = suffix.trim() || `fork-${Math.random().toString(36).slice(2, 7)}`;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/fork`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ suffix: trimmed }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(body.problem ?? 'Fork failed');
          return;
        }
        const body = (await res.json()) as { slug: string };
        toast.success('Forked');
        router.push(`/skills/${body.slug}/edit`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Fork failed');
      }
    });
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={pending}>
        Fork
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={suffix}
        onChange={(e) => setSuffix(e.target.value)}
        placeholder="suffix (e.g. -enterprise)"
        className="h-9 rounded-md border border-border bg-transparent px-2 text-[13px] outline-none focus-visible:focus-ring"
      />
      <Button variant="primary" onClick={submit} disabled={pending}>
        {pending ? 'Forking…' : 'Create fork'}
      </Button>
      <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
        Cancel
      </Button>
    </div>
  );
}
