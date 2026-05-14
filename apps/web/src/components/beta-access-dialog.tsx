'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const REQUEST_EMAIL = 'm@maakle.com';

const inputClass =
  'h-10 w-full rounded-md border border-border bg-transparent px-3 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';
const textareaClass =
  'min-h-[88px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-[13px] leading-5 text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';
const labelClass = 'caption text-text-muted';

interface BetaAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Email the user already typed on the sign-in form. Pre-fills the field
   * so they don't retype it; still editable in case they want to use a
   * different work address.
   */
  defaultEmail?: string;
}

export function BetaAccessDialog({ open, onOpenChange, defaultEmail = '' }: BetaAccessDialogProps) {
  const [email, setEmail] = React.useState(defaultEmail);
  const [useCase, setUseCase] = React.useState('');
  const [tools, setTools] = React.useState('');

  // Reset to the latest sign-in email each time the dialog opens. Without
  // this, switching emails on the sign-in form wouldn't reflect here.
  React.useEffect(() => {
    if (open) setEmail(defaultEmail);
  }, [open, defaultEmail]);

  function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const subject = 'Holo beta access request';
    const body = [
      `Email: ${email || '(not provided)'}`,
      '',
      'What I want to use holo for:',
      useCase || '(not provided)',
      '',
      'SaaS tools I use today:',
      tools || '(not provided)',
    ].join('\n');
    const url = `mailto:${REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    // Use location.href instead of window.open so it works from inside the
    // form submit handler without being blocked by popup-blockers.
    window.location.href = url;
    onOpenChange(false);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-md border border-border bg-surface p-6 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-sm text-text-muted opacity-70 transition-opacity hover:opacity-100 focus:outline-hidden focus:outline-solid focus:outline-2 focus:outline-accent"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>

          <div className="flex flex-col gap-2 pr-8">
            <span className="caption text-text-subtle">Closed beta</span>
            <DialogPrimitive.Title className="font-display text-h2 font-semibold tracking-tight text-text">
              Request access to holo
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-[13px] leading-5 text-text-muted">
              Hosted holo is currently invite-only while we polish things up.
              Tell us a bit about you and we'll get back to you. You can also
              self-host the open-source core today.
            </DialogPrimitive.Description>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="beta-email" className={labelClass}>
                Your email
              </label>
              <input
                id="beta-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className={inputClass}
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="beta-usecase" className={labelClass}>
                What do you want to use holo for?
              </label>
              <textarea
                id="beta-usecase"
                required
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
                placeholder="e.g. unify our internal docs + Linear + GitHub into one MCP for Claude"
                className={textareaClass}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="beta-tools" className={labelClass}>
                Which SaaS tools do you use today?
              </label>
              <input
                id="beta-tools"
                type="text"
                required
                value={tools}
                onChange={(e) => setTools(e.target.value)}
                placeholder="Slack, Notion, Linear, GitHub…"
                className={inputClass}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="ghost" size="default">
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button type="submit" variant="primary" size="default">
                Send request
              </Button>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
