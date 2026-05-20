'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { trackEvent, type LandingLocation } from '@/lib/posthog/events';

type Props = {
  href: string;
  external?: boolean;
  event: 'cta' | 'github';
  location: LandingLocation;
  isAuthed?: boolean;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
};

/**
 * Drop-in replacement for Link / <a> on the landing page that fires a
 * named PostHog event before navigation. CSS classes pass through.
 */
export function TrackedLink({
  href,
  external,
  event,
  location,
  isAuthed,
  className,
  children,
  ariaLabel,
}: Props) {
  function fire() {
    if (event === 'cta') {
      trackEvent('landing_cta_clicked', { location, isAuthed: !!isAuthed });
    } else {
      trackEvent('landing_github_clicked', { location });
    }
  }

  if (external) {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        className={className}
        onClick={fire}
        target={href.startsWith('http') ? '_blank' : undefined}
        rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} aria-label={ariaLabel} className={className} onClick={fire}>
      {children}
    </Link>
  );
}
