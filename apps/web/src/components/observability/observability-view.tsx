'use client';

import { useEffect, useMemo, useState } from 'react';

import { DetailDrawer } from './detail-drawer';
import { EmptyState, LoadMoreButton } from './empty-state';
import { FilterRail } from './filter-rail';
import { LogTable } from './log-table';
import { Toolbar } from './toolbar';
import type { EventRow } from './types';

interface Props {
  events: EventRow[];
  nextCursor: string | null;
  kind: string | undefined;
  status: string | undefined;
  tool: string | undefined;
  query: string;
  availableKinds: readonly string[];
  availableTools: readonly { name: string; count: number }[];
  stats: { total: number; errors: number; replays: number; replayViewers: number };
}

export function ObservabilityView({
  events,
  nextCursor,
  kind,
  status,
  tool,
  query,
  availableKinds,
  availableTools,
  stats,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => events.find((e) => e.id === selectedId) ?? null,
    [events, selectedId],
  );

  // Close drawer on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <div
      data-fullwidth
      className="-mx-6 -my-8 lg:-mx-10 lg:-my-10 flex h-[calc(100vh-56px)] min-h-0"
    >
      <FilterRail
        kind={kind}
        status={status}
        tool={tool}
        availableKinds={availableKinds}
        availableTools={availableTools}
        stats={stats}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar query={query} stats={stats} />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-auto">
            <LogTable events={events} selectedId={selectedId} onSelect={setSelectedId} />
            {nextCursor ? <LoadMoreButton cursor={nextCursor} /> : null}
            {events.length === 0 ? <EmptyState /> : null}
          </div>
          {selected ? <DetailDrawer event={selected} onClose={() => setSelectedId(null)} /> : null}
        </div>
      </div>
    </div>
  );
}
