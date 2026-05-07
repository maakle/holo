'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { updateWorkspace } from './actions';

const inputClass =
  'h-8 w-full rounded-md border border-border bg-transparent px-2 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent disabled:opacity-50';

type Field = 'name' | 'slug';

export function WorkspaceDetails({
  organizationId,
  name,
  slug,
  role,
  isOwner,
  isDefaultOrg,
}: {
  organizationId: string;
  name: string;
  slug: string;
  role: string;
  isOwner: boolean;
  isDefaultOrg: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <EditableRow
        organizationId={organizationId}
        label="Name"
        field="name"
        value={name}
        editable={isOwner}
        editLockReason={!isOwner ? 'Only owners can edit the workspace name.' : undefined}
      />
      <EditableRow
        organizationId={organizationId}
        label="Slug"
        field="slug"
        value={slug}
        editable={isOwner && !isDefaultOrg}
        mono
        editLockReason={
          isDefaultOrg
            ? 'The default workspace slug cannot be changed.'
            : !isOwner
              ? 'Only owners can edit the workspace slug.'
              : undefined
        }
        helpText="Lowercase letters, numbers, and hyphens only."
      />
      <Row label="Your role" value={role} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-4 py-3 last:border-b-0">
      <span className="text-[13px] text-text-subtle">{label}</span>
      <span className="text-[13px] text-text">{value}</span>
    </div>
  );
}

function EditableRow({
  organizationId,
  label,
  field,
  value,
  editable,
  editLockReason,
  mono,
  helpText,
}: {
  organizationId: string;
  label: string;
  field: Field;
  value: string;
  editable: boolean;
  editLockReason?: string;
  mono?: boolean;
  helpText?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit() {
    setDraft(value);
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(value);
    setError(null);
  }

  function submit() {
    if (pending) return;
    const next = draft.trim();
    if (next === value) {
      cancel();
      return;
    }
    const formData = new FormData();
    formData.append('organizationId', organizationId);
    formData.append('field', field);
    formData.append('value', next);
    startTransition(async () => {
      const result = await updateWorkspace({ ok: false }, formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not save.');
        if (result.error) toast.error(result.error);
        return;
      }
      setEditing(false);
      setError(null);
      toast.success(`${label} updated.`);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-[13px] text-text-subtle">{label}</span>
        {editing ? (
          <div className="flex flex-1 items-center justify-end gap-2">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={field === 'name' ? 64 : 48}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              className={`${inputClass} max-w-xs text-right ${mono ? 'font-mono' : ''}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancel}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={pending || !draft.trim()}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className={`text-[13px] text-text ${mono ? 'font-mono' : ''}`}>{value}</span>
            {editable ? (
              <button
                type="button"
                onClick={startEdit}
                aria-label={`Edit ${label.toLowerCase()}`}
                className="rounded-sm p-1 text-text-subtle transition-colors duration-micro ease-enter hover:text-text focus-visible:outline-hidden focus-visible:focus-ring"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        )}
      </div>
      {editing && error ? (
        <p className="mt-1.5 text-right text-[12px] text-error">{error}</p>
      ) : null}
      {editing && helpText && !error ? (
        <p className="mt-1.5 text-right text-[12px] text-text-subtle">{helpText}</p>
      ) : null}
      {!editing && !editable && editLockReason ? (
        <p className="mt-1 text-right text-[12px] text-text-subtle">{editLockReason}</p>
      ) : null}
    </div>
  );
}
