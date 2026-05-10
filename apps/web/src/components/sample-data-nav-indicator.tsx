'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { onSampleDataChanged } from '@/lib/sample-data-events';

interface Props {
  initialActive: boolean;
}

/**
 * Pinned just below the workspace nav. Visible whenever sample data is
 * installed for the active workspace, so it's always obvious that retrieval
 * results may include synthetic content. Initial state comes from the server
 * on every page load; install/remove actions in the same tab emit an event
 * that flips this indicator instantly.
 */
export function SampleDataNavIndicator({ initialActive }: Props) {
  const [active, setActive] = useState(initialActive);

  // Re-sync when SSR sends a new value — e.g. after an org switch triggers
  // router.refresh(), the layout re-renders with the new workspace's sample
  // state. Without this, the indicator keeps showing the prior org's value
  // until a hard reload.
  useEffect(() => {
    setActive(initialActive);
  }, [initialActive]);

  useEffect(() => {
    return onSampleDataChanged(setActive);
  }, []);

  if (!active) return null;

  return (
    <Link
      href="/connections#sample"
      className="mx-2 mt-2 mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-2 py-1.5 text-[12px] leading-4 text-text transition-colors duration-micro hover:bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]"
    >
      <Sparkles className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium">Sample data active</div>
        <div className="truncate text-text-muted">Star Wars dataset · click to manage</div>
      </div>
    </Link>
  );
}
