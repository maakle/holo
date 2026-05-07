'use client';
import { useEffect, useMemo, useState } from 'react';
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
  connected: boolean;
  connectedAs?: string;
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

  // Persist the active step to sessionStorage so we restore to the same step
  // after any reload (next dev's Fast Refresh hard-reload while the OAuth
  // popup is open is the motivating case).
  const stepKey = `holo:wizard-step:${meta.id}`;
  useEffect(() => {
    if (!open) return;
    const stepId = config.steps[stepIndex]?.id;
    if (stepId && typeof window !== 'undefined') {
      sessionStorage.setItem(stepKey, stepId);
    }
  }, [open, stepIndex, config.steps, stepKey]);

  function close() {
    onOpenChange(false);
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(`holo:wizard-open:${meta.id}`);
      sessionStorage.removeItem(stepKey);
    }
  }

  const ctx: WizardContext<TState> = {
    meta,
    connected,
    connectedAs,
    state,
    setState: (patch) => setState((prev) => ({ ...prev, ...patch })),
    goNext: () => setStepIndex((i) => Math.min(i + 1, config.steps.length - 1)),
    goPrev: () => setStepIndex((i) => Math.max(i - 1, 0)),
    close,
    // Refresh the server-rendered dashboard right away so the row flips from
    // "Not connected → Connected" the moment the credential row exists,
    // instead of waiting until the wizard closes. The wizard stays open on
    // top of the freshly-refreshed page while the first sync runs.
    refreshServer: () => router.refresh(),
  };

  const current = config.steps[stepIndex];
  if (!current) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Route every dismissal (escape, outside-click, programmatic) through
        // close() so sessionStorage is cleared no matter how the user exits.
        if (!next) close();
        else onOpenChange(true);
      }}
    >
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
