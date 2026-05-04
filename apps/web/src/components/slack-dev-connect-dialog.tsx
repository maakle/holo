'use client';
import { useState } from 'react';
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CLI_SNIPPET = 'pnpm holo connect slack --token xoxb-…';

export function SlackDevConnectDialog({ open, onOpenChange }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(CLI_SNIPPET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Connect Slack without OAuth</AlertDialogTitle>
          <AlertDialogDescription>
            Slack OAuth needs a public HTTPS callback URL, which is awkward for local dev. For
            development you can install the app to your workspace via Slack&apos;s admin UI and
            paste the bot token directly — skips ngrok entirely.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ol className="space-y-2 text-[13px] text-text">
          <li>
            <span className="font-medium">1.</span> Open{' '}
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              api.slack.com/apps
            </a>{' '}
            → your app → <span className="font-medium">OAuth &amp; Permissions</span>.
          </li>
          <li>
            <span className="font-medium">2.</span> Click{' '}
            <span className="font-medium">Install to Workspace</span>, approve, and copy the{' '}
            <span className="font-medium">Bot User OAuth Token</span> (<code>xoxb-…</code>).
          </li>
          <li>
            <span className="font-medium">3.</span> Run:
            <button
              type="button"
              onClick={copy}
              className="mt-1 flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-left font-mono text-[12px] hover:bg-surface-2/70"
              title="Copy"
            >
              <span className="truncate">{CLI_SNIPPET}</span>
              <span className="text-[11px] text-text-muted">{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </li>
          <li>
            <span className="font-medium">4.</span> Reload the connections page — Slack will show
            as connected and you can pick channels in <span className="font-medium">Manage</span>.
          </li>
        </ol>

        <p className="text-[12px] text-text-muted">
          Production still uses OAuth. This shortcut only appears in development.
        </p>

        <AlertDialogFooter>
          <AlertDialogCancel>Close</AlertDialogCancel>
          <AlertDialogAction onClick={copy}>{copied ? 'Copied' : 'Copy command'}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
