'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { trackEvent, type LandingLocation } from '@/lib/posthog/events';

type Props = {
  command: string;
  className?: string;
  trackLocation?: LandingLocation;
};

export function InstallPill({ command, className, trackLocation }: Props) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      if (trackLocation) {
        trackEvent('landing_install_copy', { location: trackLocation });
      }
    } catch {
      // Clipboard may be unavailable in non-secure contexts; fall back silently.
    }
  }

  return (
    <div
      className={cn(
        'inline-flex items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-4 pr-1.5 shadow-xs',
        className
      )}
    >
      <code className="font-mono text-[13px] leading-5 text-text">
        <span className="select-none text-text-subtle">$ </span>
        {command}
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy install command'}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-surface-2 hover:text-text"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-success" aria-hidden />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}
