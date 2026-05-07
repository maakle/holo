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
import { deleteWorkspace, type DeleteWorkspaceState } from './actions';

const inputClass =
  'h-9 w-full rounded-md border border-border bg-transparent px-3 text-[13px] outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-error';

const INITIAL: DeleteWorkspaceState = { ok: false };

async function action(
  prev: DeleteWorkspaceState,
  formData: FormData,
): Promise<DeleteWorkspaceState> {
  const result = await deleteWorkspace(prev, formData);
  if (!result.ok && result.error) {
    toast.error(result.error);
  }
  return result;
}

export function DangerZone({
  organizationId,
  organizationName,
  canDelete,
  reason,
}: {
  organizationId: string;
  organizationName: string;
  canDelete: boolean;
  reason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [, formAction, pending] = useActionState(action, INITIAL);
  const matches = confirmText.trim().toLowerCase() === 'delete';

  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-medium">Danger Zone</h2>
      <div className="overflow-hidden rounded-lg border border-error/40">
        <DangerRow
          title="Delete this workspace"
          description="Once you delete a workspace, there is no going back. All connections, skills, runs, and audit history will be permanently removed."
        >
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={!canDelete}
                title={reason}
              >
                Delete this workspace
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <form action={formAction}>
                <input type="hidden" name="organizationId" value={organizationId} />
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &ldquo;{organizationName}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the workspace and all of its data:
                    connections, credentials, skills, runs, audit log, members, and
                    pending invitations. <strong className="text-text">This cannot be undone.</strong>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="mt-4 space-y-1.5">
                  <label className="text-[12px] text-text-subtle">
                    Type{' '}
                    <span className="font-mono text-text">delete</span>{' '}
                    to confirm
                  </label>
                  <input
                    name="confirmName"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className={inputClass}
                    disabled={pending}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmText('')}
                  >
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    type="submit"
                    destructive
                    disabled={!matches || pending}
                  >
                    {pending ? 'Deleting…' : 'Delete workspace'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </form>
            </AlertDialogContent>
          </AlertDialog>
        </DangerRow>
      </div>
      {reason ? (
        <p className="text-[12px] text-text-subtle">{reason}</p>
      ) : null}
    </section>
  );
}

function DangerRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text">{title}</div>
        <div className="mt-0.5 text-[13px] leading-5 text-text-muted">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
