'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

interface Props {
  code: string;
  fix?: string;
}

export function ConnectErrorBanner({ code, fix }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('connect_error');
      url.searchParams.delete('connect_fix');
      router.replace(url.pathname + url.search, { scroll: false });
    }
  }

  const isPlanLimit = code === 'HOLO_PLAN_LIMIT_REACHED';

  return (
    <div className="relative rounded-md border border-error/30 bg-[color-mix(in_srgb,var(--error)_10%,transparent)] p-4 pr-10 text-[13px]">
      <div className="font-medium text-error">
        {isPlanLimit ? "You've hit your plan's connector limit" : code}
      </div>
      {fix ? <div className="mt-1 text-error/80">{fix}</div> : null}
      {isPlanLimit ? (
        <Link
          href="/settings/billing"
          className="mt-2 inline-block text-accent underline-offset-2 hover:underline"
        >
          View plans →
        </Link>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 rounded-sm p-1 text-error/70 transition-colors hover:bg-error/10 hover:text-error focus:outline-hidden focus:focus-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
