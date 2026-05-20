'use client';

import { useEffect, useRef } from 'react';
import { trackEvent, type LandingSection } from '@/lib/posthog/events';

/**
 * Fires `landing_section_viewed` once per page load when at least 30% of
 * the wrapped section becomes visible. Renders nothing of its own —
 * mount it as a sibling inside a section so the IntersectionObserver
 * watches the section's bounding box.
 */
export function TrackInView({ section }: { section: LandingSection }) {
  const ref = useRef<HTMLDivElement>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || firedRef.current) return;
    const target = el.parentElement ?? el;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !firedRef.current) {
            firedRef.current = true;
            trackEvent('landing_section_viewed', { section });
            io.disconnect();
            return;
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [section]);

  return <div ref={ref} aria-hidden className="sr-only" />;
}
