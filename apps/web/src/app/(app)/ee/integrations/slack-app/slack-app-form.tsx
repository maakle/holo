'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const inputClass =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent';

const inputErrorClass =
  'h-9 w-full rounded-md border border-error bg-surface px-3 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-error';

type FieldKey = 'clientId' | 'clientSecret' | 'signingSecret';

export interface ExistingConfig {
  id: string;
  appId: string | null;
  clientId: string;
  displayName: string | null;
  updatedAt: Date;
}

export function SlackAppConfigForm({
  existing,
  canEdit,
  ownerReason,
  displayName,
}: {
  existing: ExistingConfig | null;
  canEdit: boolean;
  ownerReason: string | null;
  displayName: string;
}) {
  const [appId, setAppId] = useState(existing?.appId ?? '');
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  // Secrets are write-only — we never receive them back, so the field is
  // either empty (no change on edit) or a fresh value the owner just pasted.
  const [clientSecret, setClientSecret] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [pending, startTransition] = useTransition();

  function clearError(field: FieldKey) {
    if (!errors[field]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  async function save() {
    const nextErrors: Partial<Record<FieldKey, string>> = {};
    if (!clientId.trim()) nextErrors.clientId = 'Required.';
    // When editing, blank secret fields keep the existing values intact
    // server-side only because the schema requires non-empty — so for an
    // edit-without-rotating, we re-PUT with the same secrets we don't know.
    // Force the owner to re-enter both secrets on every save. That's the
    // safe default: it's the only way the UI can guarantee the value
    // landing in the DB matches what's pasted on screen.
    if (!clientSecret.trim()) nextErrors.clientSecret = 'Required.';
    if (!signingSecret.trim()) nextErrors.signingSecret = 'Required.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const count = Object.keys(nextErrors).length;
      toast.error(
        count === 1 ? 'Fill in the highlighted field.' : `Fill in ${count} required fields.`,
      );
      return;
    }
    setErrors({});

    startTransition(async () => {
      try {
        const res = await fetch('/api/ee/slack-app-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId: appId.trim() || null,
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
            signingSecret: signingSecret.trim(),
            displayName: displayName.trim() || null,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(body.problem ?? 'Save failed.');
          return;
        }
        toast.success('Custom Slack app saved.');
        setClientSecret('');
        setSigningSecret('');
        // Refresh to surface the new updatedAt and pin the form to "edit" mode.
        if (typeof window !== 'undefined') window.location.reload();
      } catch {
        toast.error('Network error.');
      }
    });
  }

  async function remove() {
    if (
      !window.confirm(
        'Remove the custom Slack app? Slack must already be disconnected — this only removes the credentials, it does not uninstall from Slack.',
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/ee/slack-app-config', { method: 'DELETE' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { problem?: string };
          toast.error(body.problem ?? 'Remove failed.');
          return;
        }
        toast.success('Custom Slack app removed.');
        if (typeof window !== 'undefined') window.location.reload();
      } catch {
        toast.error('Network error.');
      }
    });
  }

  return (
    <div className="space-y-4">
      {existing ? (
        <p className="text-[12px] text-text-subtle">
          A custom Slack app is configured for this workspace
          {existing.appId ? (
            <>
              {' '}
              (<span className="font-mono text-text">{existing.appId}</span>)
            </>
          ) : null}
          . New Slack installs will use it instead of the shared Holo app.
        </p>
      ) : (
        <p className="text-[12px] text-text-subtle">
          No custom Slack app yet — installs fall back to the shared Holo app.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="App ID" optional>
          <input
            className={`${inputClass} font-mono`}
            value={appId}
            placeholder="A0123456789"
            onChange={(e) => setAppId(e.target.value)}
            disabled={!canEdit || pending}
          />
        </Field>
        <Field label="Client ID" required error={errors.clientId}>
          <input
            className={`${(errors.clientId ? inputErrorClass : inputClass)} font-mono`}
            value={clientId}
            placeholder="1234567890.1234567890"
            onChange={(e) => {
              setClientId(e.target.value);
              clearError('clientId');
            }}
            disabled={!canEdit || pending}
            aria-invalid={Boolean(errors.clientId)}
          />
        </Field>
        <Field label="Client Secret" required error={errors.clientSecret}>
          <input
            type="password"
            className={`${(errors.clientSecret ? inputErrorClass : inputClass)} font-mono`}
            value={clientSecret}
            placeholder={existing ? '•••••• (re-enter to update)' : ''}
            onChange={(e) => {
              setClientSecret(e.target.value);
              clearError('clientSecret');
            }}
            disabled={!canEdit || pending}
            autoComplete="new-password"
            aria-invalid={Boolean(errors.clientSecret)}
          />
        </Field>
        <Field label="Signing Secret" required error={errors.signingSecret}>
          <input
            type="password"
            className={`${(errors.signingSecret ? inputErrorClass : inputClass)} font-mono`}
            value={signingSecret}
            placeholder={existing ? '•••••• (re-enter to update)' : ''}
            onChange={(e) => {
              setSigningSecret(e.target.value);
              clearError('signingSecret');
            }}
            disabled={!canEdit || pending}
            autoComplete="new-password"
            aria-invalid={Boolean(errors.signingSecret)}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2">
        <span className="text-[12px] text-text-subtle">
          {ownerReason ?? 'Secrets are encrypted at rest.'}
        </span>
        <div className="flex gap-2">
          {existing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={!canEdit || pending}
            >
              Remove
            </Button>
          ) : null}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={save}
            disabled={!canEdit || pending}
          >
            {pending ? 'Saving…' : existing ? 'Update app' : 'Save app'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
  required,
  optional,
  error,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
  optional?: boolean;
  error?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? 'md:col-span-2' : ''}`}>
      <span className="flex items-center gap-1 text-[12px] text-text-subtle">
        <span>{label}</span>
        {required ? (
          <span className="text-error" aria-hidden="true">
            *
          </span>
        ) : null}
        {optional ? (
          <span className="text-text-subtle">(optional)</span>
        ) : null}
      </span>
      {children}
      {error ? <span className="text-[11px] text-error">{error}</span> : null}
    </label>
  );
}
