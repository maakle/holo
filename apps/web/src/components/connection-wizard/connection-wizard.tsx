'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ConnectorMeta } from '@/lib/connector-registry';
import type { ConnectorWizardConfig, WizardContext } from './types';

interface Props<TState> {
  meta: ConnectorMeta;
  config: ConnectorWizardConfig<TState>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-driven flag: is the connector currently connected? */
  connected: boolean;
  /** Display name of the connected workspace/account, when available. */
  connectedAs?: string;
  /** Step to start at (defaults to the first step). Useful for soft-heuristic
   *  re-entry that wants to skip already-completed steps. */
  initialStepId?: string;
}

export function ConnectionWizard<TState>({
  meta,
  config,
  open,
  onOpenChange,
  connected,
  connectedAs,
  initialStepId,
}: Props<TState>) {
  const router = useRouter();
  const initialIndex = useMemo(() => {
    if (!initialStepId) return 0;
    const idx = config.steps.findIndex((s) => s.id === initialStepId);
    return idx >= 0 ? idx : 0;
  }, [config.steps, initialStepId]);

  const [stepIndex, setStepIndex] = useState(initialIndex);
  const [state, setState] = useState<TState>(config.initialState);

  const ctx: WizardContext<TState> = {
    meta,
    connected,
    connectedAs,
    state,
    setState: (patch) => setState((prev) => ({ ...prev, ...patch })),
    goNext: () => setStepIndex((i) => Math.min(i + 1, config.steps.length - 1)),
    goPrev: () => setStepIndex((i) => Math.max(i - 1, 0)),
    close: () => onOpenChange(false),
    refreshServer: () => router.refresh(),
  };

  const current = config.steps[stepIndex];
  if (!current) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Set up {meta.displayName}</AlertDialogTitle>
          <AlertDialogDescription>
            {connectedAs ? `Connected to ${connectedAs}. ` : ''}
            {meta.description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {config.steps.length > 1 ? (
          <ol className="flex items-center gap-2 text-[12px]">
            {config.steps.map((s, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <li
                  key={s.id}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 ${
                    active
                      ? 'border-accent text-accent'
                      : done
                        ? 'border-success text-success'
                        : 'border-border text-text-muted'
                  }`}
                >
                  {done ? (
                    <Check className="h-3 w-3" aria-hidden />
                  ) : (
                    <span className="font-medium">{i + 1}</span>
                  )}
                  <span>{s.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        {current.render(ctx)}
      </AlertDialogContent>
    </AlertDialog>
  );
}
