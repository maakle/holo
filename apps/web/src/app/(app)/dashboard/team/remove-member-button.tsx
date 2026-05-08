'use client';

import { useState, useTransition } from 'react';
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
import { removeMember } from './actions';

export function RemoveMemberButton({
  memberId,
  memberLabel,
}: {
  memberId: string;
  memberLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          className="text-[13px] text-text-muted hover:text-error disabled:opacity-50"
          disabled={pending}
        >
          {pending ? 'Removing…' : 'Remove'}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {memberLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll lose access to this workspace immediately. You can re-invite them later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            destructive
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const fd = new FormData();
                fd.append('memberId', memberId);
                const result = await removeMember(fd);
                if (result.ok) {
                  toast.success(`Removed ${memberLabel}`);
                  setOpen(false);
                } else if (result.error) {
                  toast.error(result.error);
                }
              });
            }}
          >
            {pending ? 'Removing…' : 'Remove'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
