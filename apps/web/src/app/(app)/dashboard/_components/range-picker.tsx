'use client';

import { useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type Range = '7d' | '30d';

const LABEL: Record<Range, string> = {
  '7d': '7D',
  '30d': '30D',
};

export function RangePicker({ value }: { value: Range }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const select = (next: Range) => {
    if (next === value) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === '7d') params.delete('range');
    else params.set('range', next);
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Select time range"
          disabled={pending}
          className="caption inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {LABEL[value]}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-24">
        {(['7d', '30d'] as const).map((r) => (
          <DropdownMenuItem
            key={r}
            onSelect={(e) => {
              e.preventDefault();
              select(r);
            }}
          >
            Last {LABEL[r]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
