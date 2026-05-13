'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function PromoteButton({ slug }: { slug: string }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function go() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/promote`, {
          method: 'POST',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(body.problem ?? 'Promote failed');
          return;
        }
        toast.success('Promoted to active');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Promote failed');
      }
    });
  }

  return (
    <Button variant="secondary" onClick={go} disabled={pending}>
      {pending ? 'Promoting…' : 'Promote'}
    </Button>
  );
}
