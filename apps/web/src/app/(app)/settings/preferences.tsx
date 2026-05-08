'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { updateOrgPreferences } from './actions';

export function Preferences({
  organizationId,
  hideSampleData,
  isOwner,
}: {
  organizationId: string;
  hideSampleData: boolean;
  isOwner: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <ToggleRow
        organizationId={organizationId}
        label="Hide sample data"
        description="Hides the Star Wars sample dataset from the Connections page."
        initial={hideSampleData}
        editable={isOwner}
        editLockReason={!isOwner ? 'Only owners can edit workspace preferences.' : undefined}
      />
    </div>
  );
}

function ToggleRow({
  organizationId,
  label,
  description,
  initial,
  editable,
  editLockReason,
}: {
  organizationId: string;
  label: string;
  description: string;
  initial: boolean;
  editable: boolean;
  editLockReason?: string;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function onToggle() {
    if (!editable || pending) return;
    const next = !value;
    setValue(next);
    startTransition(async () => {
      const result = await updateOrgPreferences({
        organizationId,
        hideSampleData: next,
      });
      if (!result.ok) {
        setValue(!next);
        toast.error(result.error ?? 'Could not save preference.');
      }
    });
  }

  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-text">{label}</div>
          <div className="mt-0.5 text-[13px] leading-5 text-text-muted">{description}</div>
          {!editable && editLockReason ? (
            <div className="mt-1 text-[12px] text-text-subtle">{editLockReason}</div>
          ) : null}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-label={label}
          onClick={onToggle}
          disabled={!editable || pending}
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors duration-micro focus-visible:outline-hidden focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${
            value
              ? 'border-transparent bg-accent'
              : 'border-border bg-surface-2'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-text shadow-sm transition-transform duration-micro ${
              value ? 'translate-x-[18px]' : 'translate-x-[2px]'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
