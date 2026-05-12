'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { ConnectorRow } from '@/components/connector-row';
import {
  CONNECTOR_CATEGORIES,
  type ConnectorMeta,
} from '@/lib/connector-registry';

export interface ConnectorBrowserItem {
  meta: ConnectorMeta;
  status: 'connected' | 'disconnected';
  connectedAs?: string;
  allowlist: { pattern: string; isGlob: boolean; label: string | null }[];
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  /**
   * Initial render hint: a `connector_disconnect_jobs` row with `finished_at IS
   * NULL` was present at SSR time, so the row should mount in its
   * "Disconnecting…" state without waiting for the first status poll.
   */
  initialDisconnecting?: boolean;
}

interface Props {
  items: ConnectorBrowserItem[];
  showSampleNav: boolean;
}

export function ConnectorBrowser({ items, showSampleNav }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => {
      const m = item.meta;
      return (
        m.displayName.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
      );
    });
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ConnectorBrowserItem[]>();
    for (const item of filtered) {
      const arr = map.get(item.meta.category) ?? [];
      arr.push(item);
      map.set(item.meta.category, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));
    }
    return map;
  }, [filtered]);

  const visibleCategories = CONNECTOR_CATEGORIES.filter(
    (cat) => (grouped.get(cat.id)?.length ?? 0) > 0,
  );

  return (
    <div className="flex flex-col gap-6">
      <label className="relative block">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools…"
          aria-label="Search tools"
          className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-[14px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
        />
      </label>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-[180px_1fr]">
        <nav className="hidden md:block">
          <div className="sticky top-6 flex flex-col gap-1">
            <span className="caption mb-2 text-text-subtle">Categories</span>
            {showSampleNav ? (
              <a
                href="#cat-sample"
                className="text-[13px] leading-6 text-text-muted transition-colors duration-micro hover:text-text"
              >
                Sample data
              </a>
            ) : null}
            {visibleCategories.map((cat) => (
              <a
                key={cat.id}
                href={`#cat-${cat.id}`}
                className="text-[13px] leading-6 text-text-muted transition-colors duration-micro hover:text-text"
              >
                {cat.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="flex flex-col gap-8">
          {visibleCategories.length === 0 ? (
            <div className="rounded-md border border-border bg-surface px-5 py-8 text-center text-[13px] text-text-muted">
              No tools match &ldquo;{query}&rdquo;.
            </div>
          ) : null}
          {visibleCategories.map((cat) => {
            const catItems = grouped.get(cat.id) ?? [];
            return (
              <section
                key={cat.id}
                id={`cat-${cat.id}`}
                className="flex flex-col gap-3 scroll-mt-6"
              >
                <span className="caption text-text-subtle">{cat.label}</span>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {catItems.map((item) => (
                    <div
                      key={item.meta.id}
                      className="overflow-hidden rounded-md border border-border bg-surface transition-colors duration-micro hover:bg-surface-2/40"
                    >
                      <ConnectorRow
                        meta={item.meta}
                        status={item.status}
                        connectedAs={item.connectedAs}
                        allowlist={item.allowlist}
                        lastSyncedAt={item.lastSyncedAt}
                        lastSyncStatus={item.lastSyncStatus}
                        initialDisconnecting={item.initialDisconnecting}
                      />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
