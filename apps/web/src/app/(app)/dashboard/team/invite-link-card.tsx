'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, Link2, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
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
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { regenerateInviteLink, revokeInviteLink } from './actions';

type Confirm = 'regenerate' | 'revoke' | null;

export function InviteLinkCard({
  initialUrl,
}: {
  initialUrl: string | null;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [pending, startTransition] = useTransition();

  const handleGenerate = () =>
    startTransition(async () => {
      const result = await regenerateInviteLink();
      if (result.ok && result.token) {
        const next = `${window.location.origin}/join/${result.token}`;
        setUrl(next);
        toast.success(initialUrl ? 'New invite link generated' : 'Invite link generated');
      } else if (result.error) {
        toast.error(result.error);
      }
      setConfirm(null);
    });

  const handleRevoke = () =>
    startTransition(async () => {
      const result = await revokeInviteLink();
      if (result.ok) {
        setUrl(null);
        toast.success('Invite link revoked');
      } else if (result.error) {
        toast.error(result.error);
      }
      setConfirm(null);
    });

  const handleCopy = () => {
    if (!url) return;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Copied to clipboard'))
      .catch(() => toast.error('Could not copy. Select the link and copy manually.'));
  };

  if (!url) {
    return (
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="space-y-1">
          <span className="caption text-text-subtle">Invite link</span>
          <p className="text-[13px] text-text-muted">
            Share one URL with anyone you want to add. They&apos;ll join as a Member.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={handleGenerate}
          className="self-start"
        >
          <Link2 className="h-3.5 w-3.5" />
          {pending ? 'Generating…' : 'Generate invite link'}
        </Button>
      </section>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <div className="space-y-1">
          <span className="caption text-text-subtle">Invite link</span>
          <p className="text-[13px] text-text-muted">
            Anyone with this link can join as a Member.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="h-9 flex-1 rounded-md border border-border bg-transparent px-3 font-mono text-[13px] text-text outline-hidden focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopy}
              disabled={pending}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More invite link actions"
                  disabled={pending}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-muted transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-50"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirm('regenerate');
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate link
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirm('revoke');
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'regenerate' ? 'Regenerate invite link?' : 'Revoke invite link?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'regenerate'
                ? 'The current link will stop working immediately. Anyone you already shared it with will need the new link.'
                : 'The link will stop working immediately. Anyone you already shared it with will lose the ability to join.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive={confirm === 'revoke'}
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === 'regenerate') handleGenerate();
                else if (confirm === 'revoke') handleRevoke();
              }}
            >
              {pending
                ? confirm === 'revoke'
                  ? 'Revoking…'
                  : 'Regenerating…'
                : confirm === 'revoke'
                  ? 'Revoke'
                  : 'Regenerate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
