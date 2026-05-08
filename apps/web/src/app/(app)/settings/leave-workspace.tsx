'use client';

import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { leaveWorkspace, type LeaveWorkspaceState } from './actions';

const INITIAL: LeaveWorkspaceState = { ok: false };

async function action(
  prev: LeaveWorkspaceState,
  formData: FormData,
): Promise<LeaveWorkspaceState> {
  const result = await leaveWorkspace(prev, formData);
  if (!result.ok && result.error) {
    toast.error(result.error);
  }
  return result;
}

export function LeaveWorkspace({
  organizationId,
  organizationName,
  canLeave,
  reason,
}: {
  organizationId: string;
  organizationName: string;
  canLeave: boolean;
  reason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [, formAction, pending] = useActionState(action, INITIAL);

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium">Membership</h2>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-text">Leave this workspace</div>
            <div className="mt-0.5 text-[13px] leading-5 text-text-muted">
              You&apos;ll lose access to {organizationName} immediately. To come back, an
              owner or admin needs to invite you again.
            </div>
          </div>
          <div className="shrink-0">
            <AlertDialog open={open} onOpenChange={setOpen}>
              <AlertDialogTrigger asChild>
                <Button variant="secondary" size="sm" disabled={!canLeave} title={reason}>
                  Leave workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <form action={formAction}>
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <AlertDialogHeader>
                    <AlertDialogTitle>Leave &ldquo;{organizationName}&rdquo;?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You&apos;ll lose access to this workspace&apos;s connections, skills, and
                      audit history immediately. You&apos;ll need a fresh invitation to
                      rejoin.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel type="button" disabled={pending}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction type="submit" destructive disabled={pending}>
                      {pending ? 'Leaving…' : 'Leave workspace'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </form>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
      {reason ? <p className="text-[12px] text-text-subtle">{reason}</p> : null}
    </section>
  );
}
