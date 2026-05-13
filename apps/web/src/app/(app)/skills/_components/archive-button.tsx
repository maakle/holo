'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

export function ArchiveButton({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function go() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/skills/${encodeURIComponent(slug)}/archive`, {
          method: 'POST',
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(body.problem ?? 'Archive failed');
          return;
        }
        toast.success('Archived');
        setOpen(false);
        router.push('/skills');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Archive failed');
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost">Archive</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive this skill?</AlertDialogTitle>
          <AlertDialogDescription>
            Archived skills hide from the list and stop being used by the
            orchestrator. Existing run history is preserved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={go} disabled={pending}>
            {pending ? 'Archiving…' : 'Archive'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
