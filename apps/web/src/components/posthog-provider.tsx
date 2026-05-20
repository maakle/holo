'use client';

import { Suspense, useEffect, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import posthog from 'posthog-js';
import { initPostHogBrowser } from '@/lib/posthog/client';

function PostHogPageview() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    const search = searchParams?.toString();
    const url = search ? `${pathname}?${search}` : pathname;
    posthog.capture('$pageview', { $current_url: url, $pathname: pathname });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    initPostHogBrowser();
  }, []);

  // When the key isn't set, posthog.init() never ran. PHProvider tolerates
  // an unintialized client (it just hands it to context), so wrapping is
  // safe — children render exactly the same.
  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageview />
      </Suspense>
      {children}
    </PHProvider>
  );
}
