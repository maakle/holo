'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

const inputClass =
  'h-9 w-full rounded-md border border-border bg-transparent px-3 text-[13px] outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent';

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
}: {
  existing: ExistingConfig | null;
  canEdit: boolean;
  ownerReason: string | null;
}) {
  const [appId, setAppId] = useState(existing?.appId ?? '');
  const [clientId, setClientId] = useState(existing?.clientId ?? '');
  // Secrets are write-only — we never receive them back, so the field is
  // either empty (no change on edit) or a fresh value the owner just pasted.
  const [clientSecret, setClientSecret] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!clientId.trim()) {
      toast.error('Client ID is required.');
      return;
    }
    // When editing, blank secret fields keep the existing values intact
    // server-side only because the schema requires non-empty — so for an
    // edit-without-rotating, we re-PUT with the same secrets we don't know.
    // Force the owner to re-enter both secrets on every save. That's the
    // safe default: it's the only way the UI can guarantee the value
    // landing in the DB matches what's pasted on screen.
    if (!clientSecret.trim() || !signingSecret.trim()) {
      toast.error('Paste client_secret and signing_secret to save.');
      return;
    }

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
        <Field label="Display name (optional)">
          <input
            className={inputClass}
            value={displayName}
            placeholder="e.g. Acme Holo Bot"
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={!canEdit || pending}
          />
        </Field>
        <Field label="App ID (optional)">
          <input
            className={`${inputClass} font-mono`}
            value={appId}
            placeholder="A0123456789"
            onChange={(e) => setAppId(e.target.value)}
            disabled={!canEdit || pending}
          />
        </Field>
        <Field label="Client ID">
          <input
            className={`${inputClass} font-mono`}
            value={clientId}
            placeholder="1234567890.1234567890"
            onChange={(e) => setClientId(e.target.value)}
            disabled={!canEdit || pending}
          />
        </Field>
        <Field label="Client Secret">
          <input
            type="password"
            className={`${inputClass} font-mono`}
            value={clientSecret}
            placeholder={existing ? '•••••• (re-enter to update)' : ''}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={!canEdit || pending}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Signing Secret" full>
          <input
            type="password"
            className={`${inputClass} font-mono`}
            value={signingSecret}
            placeholder={existing ? '•••••• (re-enter to update)' : ''}
            onChange={(e) => setSigningSecret(e.target.value)}
            disabled={!canEdit || pending}
            autoComplete="new-password"
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
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${full ? 'md:col-span-2' : ''}`}>
      <span className="text-[12px] text-text-subtle">{label}</span>
      {children}
    </label>
  );
}
