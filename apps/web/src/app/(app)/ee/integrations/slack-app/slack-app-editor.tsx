'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { ManifestBlock } from './manifest-block';
import { SlackAppConfigForm, type ExistingConfig } from './slack-app-form';
import { DISPLAY_NAME_PLACEHOLDER } from './constants';

const inputClass =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-[13px] text-text outline-hidden placeholder:text-text-subtle focus:border-transparent focus:outline-solid focus:outline-2 focus:outline-accent';

export interface SlackAppEditorProps {
  existing: ExistingConfig | null;
  canEdit: boolean;
  ownerReason: string | null;
  manifestTemplate: string | null;
  oauthRedirectUrl: string;
  eventsRequestUrl: string | null;
  slashCommandsUrl: string | null;
}

export function SlackAppEditor({
  existing,
  canEdit,
  ownerReason,
  manifestTemplate,
  oauthRedirectUrl,
  eventsRequestUrl,
  slashCommandsUrl,
}: SlackAppEditorProps) {
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '');
  const effectiveName = displayName.trim() || 'Holo';
  const manifest = manifestTemplate
    ? manifestTemplate.replaceAll(DISPLAY_NAME_PLACEHOLDER, effectiveName)
    : null;

  return (
    <>
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">1. Create the Slack app</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          In{' '}
          <a
            className="text-accent hover:underline"
            href="https://api.slack.com/apps"
            target="_blank"
            rel="noreferrer"
          >
            api.slack.com/apps
          </a>{' '}
          click <span className="font-mono text-text">Create New App</span> →{' '}
          <span className="font-mono text-text">From a manifest</span>, pick
          your workspace, and paste the YAML below. The manifest is pre-filled
          with the right scopes, event subscriptions, and org-scoped webhook
          URLs so Slack delivers events to this tenant.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] text-text-subtle">
            Display name (shown in Slack as the bot user)
          </span>
          <input
            className={inputClass}
            value={displayName}
            placeholder="e.g. Acme Holo Bot"
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={!canEdit}
          />
          <span className="text-[11px] text-text-subtle">
            Edits update the manifest preview below. Save credentials in
            step 2 to persist the name for future visits.
          </span>
        </label>

        {manifest ? (
          <ManifestBlock manifest={manifest} />
        ) : (
          <div className="rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-text-muted">
            Set <span className="font-mono text-text">MCP_PUBLIC_URL</span> on
            the web deployment so the manifest can include the gateway event
            and slash-command URLs.
          </div>
        )}

        <details className="text-[12px] text-text-subtle">
          <summary className="cursor-pointer select-none">
            Or configure the URLs manually
          </summary>
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            <UrlRow label="OAuth redirect URL" value={oauthRedirectUrl} />
            <UrlRow label="Events Request URL" value={eventsRequestUrl} />
            <UrlRow label="Slash commands URL" value={slashCommandsUrl} />
          </div>
        </details>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">2. Paste credentials</h2>
        <p className="text-[13px] leading-5 text-text-muted">
          Copy <span className="font-mono text-text">Client ID</span>,{' '}
          <span className="font-mono text-text">Client Secret</span>, and{' '}
          <span className="font-mono text-text">Signing Secret</span> from
          your Slack app&apos;s{' '}
          <span className="font-mono text-text">Basic Information</span> page.
          Secrets are encrypted at rest and never returned by the API.
        </p>
        <SlackAppConfigForm
          existing={existing}
          canEdit={canEdit}
          ownerReason={ownerReason}
          displayName={displayName}
        />
      </section>
    </>
  );
}

function UrlRow({ label, value }: { label: string; value: string | null }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    if (!value) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        toast.success(`${label} copied`);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error('Could not copy. Select the URL manually.'));
  }

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="shrink-0 text-[13px] text-text-subtle">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-text">
        {value ?? '— set MCP_PUBLIC_URL to surface this URL —'}
      </span>
      <button
        type="button"
        onClick={copy}
        disabled={!value}
        aria-label={`Copy ${label}`}
        className="shrink-0 rounded-md p-1.5 text-text-subtle transition-colors duration-micro ease-enter hover:bg-surface-2 hover:text-text focus-visible:outline-hidden focus-visible:focus-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

