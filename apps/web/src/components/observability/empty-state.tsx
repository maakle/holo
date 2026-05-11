'use client';

import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';

export function LoadMoreButton({ cursor }: { cursor: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <div className="flex justify-center px-4 py-4">
      <button
        type="button"
        onClick={() => {
          const next = new URLSearchParams(sp.toString());
          next.set('cursor', cursor);
          router.push(`${pathname}?${next.toString()}`);
        }}
        className="rounded-sm border px-3 py-1.5 text-[12px] font-medium"
        style={{
          borderColor: 'var(--border)',
          color: 'var(--text-muted)',
          background: 'var(--surface-2)',
        }}
      >
        Load older →
      </button>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="text-center">
        <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          No agent activity matches the current filters.
        </p>
        <Link
          href="/connect-agent"
          className="mt-3 inline-block text-[13px]"
          style={{ color: 'var(--accent)' }}
        >
          Connect an agent →
        </Link>
      </div>
    </div>
  );
}
