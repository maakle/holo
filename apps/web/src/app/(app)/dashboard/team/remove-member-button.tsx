'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { removeMember } from './actions';

export function RemoveMemberButton({
  memberId,
  memberLabel,
}: {
  memberId: string;
  memberLabel: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${memberLabel} from this workspace?`)) return;
        startTransition(async () => {
          const fd = new FormData();
          fd.append('memberId', memberId);
          const result = await removeMember(fd);
          if (result.ok) {
            toast.success(`Removed ${memberLabel}`);
          } else if (result.error) {
            toast.error(result.error);
          }
        });
      }}
      className="text-[13px] text-text-muted hover:text-error disabled:opacity-50"
    >
      {pending ? 'Removing…' : 'Remove'}
    </button>
  );
}
