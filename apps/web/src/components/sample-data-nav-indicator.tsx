'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

interface Props {
  initialActive: boolean;
}

/**
 * Pinned just below the workspace nav. Visible whenever sample data is
 * installed for the active workspace, so it's always obvious that retrieval
 * results may include synthetic content. Polls in the background so the
 * indicator disappears as soon as the user removes the sample dataset from
 * the connections page.
 */
export function SampleDataNavIndicator({ initialActive }: Props) {
  const [active, setActive] = useState(initialActive);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const res = await fetch('/api/sample-data', { cache: 'no-store' });
        if (!cancelled && res.ok) {
          const data = (await res.json()) as { active?: boolean };
          setActive(Boolean(data.active));
        }
      } catch {
        // ignore — try again later
      }
      if (!cancelled) timer = setTimeout(tick, 30_000);
    }
    timer = setTimeout(tick, 10_000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!active) return null;

  return (
    <Link
      href="/connections#sample"
      className="mx-2 mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-2 py-1.5 text-[12px] leading-4 text-text transition-colors duration-micro hover:bg-[color-mix(in_srgb,var(--warning)_16%,transparent)]"
    >
      <Sparkles className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium">Sample data active</div>
        <div className="truncate text-text-muted">Star Wars dataset · click to manage</div>
      </div>
    </Link>
  );
}
