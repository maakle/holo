'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

export interface PlanLimitInfo {
  currentPlanName: string;
  limit: number;
  currentCount: number;
  suggestedUpgradeSlug: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  info: PlanLimitInfo | null;
}

/**
 * Upgrade prompt shown when a connector add hits the plan limit. Used by the
 * connection wizard's API-key step and surfaced from the connections page
 * when an OAuth finalize comes back with `HOLO_PLAN_LIMIT_REACHED`. Routes
 * the user to /settings/billing with the suggested plan tile pre-selected
 * via a query param.
 *
 * Single accent CTA per DESIGN.md. No gradient. No purple. Indigo only.
 */
export function UpgradeModal({ open, onOpenChange, info }: Props) {
  const router = useRouter();

  // Prefetch billing page so the View Plans click is instant.
  useEffect(() => {
    if (open) router.prefetch('/settings/billing');
  }, [open, router]);

  if (!info) return null;

  const limitWord = `${info.limit} connector${info.limit === 1 ? '' : 's'}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-surface p-6 shadow-2xl outline-hidden"
        >
          <div className="flex items-start justify-between gap-4">
            <Dialog.Title className="font-display text-[18px] font-semibold leading-7 text-text">
              You've hit the plan limit
            </Dialog.Title>
            <Dialog.Close
              aria-label="Dismiss"
              className="rounded-sm p-1 text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-hidden focus:focus-ring"
            >
              <X className="h-4 w-4" aria-hidden />
            </Dialog.Close>
          </div>

          <Dialog.Description asChild>
            <div className="mt-3 space-y-3 text-[13px] leading-5 text-text-muted">
              <p>
                <span className="text-text">{info.currentPlanName}</span>{' '}
                includes {limitWord}. You're already using{' '}
                <span className="tabular-nums text-text">{info.currentCount}</span>.
              </p>
              <p>
                Your Star Wars sample dataset stays included on every plan — it
                doesn't count against the connector limit.
              </p>
            </div>
          </Dialog.Description>

          <div className="mt-6 flex items-center justify-end gap-2">
            <Dialog.Close
              type="button"
              className="rounded-md border border-border bg-surface px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2"
            >
              Not now
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                router.push(
                  `/settings/billing?upgrade=${encodeURIComponent(info.suggestedUpgradeSlug)}`,
                );
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              View plans
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
