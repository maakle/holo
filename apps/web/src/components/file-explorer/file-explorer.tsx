'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FolderIcon,
  FileTextIcon,
  MessageSquareIcon,
  GitPullRequestIcon,
  StickyNoteIcon,
  PhoneCallIcon,
  TicketIcon,
  Building2Icon,
  FileCodeIcon,
  GlobeIcon,
  HashIcon,
  DatabaseIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  HomeIcon,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Markdown } from '@/components/ui/markdown';

const PAGE_SIZE = 50;

type SortColumn = 'name' | 'source' | 'size' | 'updatedAt';
type SortDirection = 'asc' | 'desc';
interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

function compareEntries(a: DirChild, b: DirChild, sort: SortState): number {
  const dir = sort.direction === 'asc' ? 1 : -1;
  if (sort.column === 'name') {
    return a.name.localeCompare(b.name) * dir;
  }
  if (sort.column === 'source') {
    const av = a.source ?? '';
    const bv = b.source ?? '';
    // Fall back to name for equal/empty sources so the tie-break is stable.
    const primary = av.localeCompare(bv) * dir;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  }
  if (sort.column === 'size') {
    const primary = (a.sizeBytes - b.sizeBytes) * dir;
    return primary !== 0 ? primary : a.name.localeCompare(b.name);
  }
  // updatedAt — nulls always sink to the bottom regardless of direction.
  const at = a.updatedAt ? new Date(a.updatedAt).getTime() : null;
  const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : null;
  if (at === null && bt === null) return a.name.localeCompare(b.name);
  if (at === null) return 1;
  if (bt === null) return -1;
  const primary = (at - bt) * dir;
  return primary !== 0 ? primary : a.name.localeCompare(b.name);
}

interface DirChild {
  name: string;
  type: 'file' | 'directory';
  source: string | null;
  updatedAt: string | null;
  kind: string | null;
  sizeBytes: number;
}

interface ListResponse {
  path: string;
  entries: DirChild[];
}

interface ContentResponse {
  path: string;
  kind: string | null;
  content: string;
  artifactId: string | null;
  updatedAt: string | null;
}

interface ApiError {
  problem: string;
  fix?: string;
}

function iconForEntry(entry: DirChild) {
  if (entry.type === 'directory') return FolderIcon;
  const k = entry.kind ?? entry.source ?? '';
  if (k.startsWith('slack')) return MessageSquareIcon;
  if (k.startsWith('github-pr') || k.startsWith('github-issue')) return GitPullRequestIcon;
  if (k.startsWith('github')) return FileCodeIcon;
  if (k.startsWith('notion')) return StickyNoteIcon;
  if (k.startsWith('grain')) return PhoneCallIcon;
  if (k.startsWith('pylon')) return TicketIcon;
  if (k.startsWith('hubspot') || k.startsWith('salesforce')) return Building2Icon;
  if (k.startsWith('webcrawl') || k.startsWith('mintlify') || k.startsWith('prismic')) return GlobeIcon;
  if (k.startsWith('stripe')) return DatabaseIcon;
  if (k.startsWith('zendesk')) return HashIcon;
  return FileTextIcon;
}

function prettySource(source: string | null): string {
  if (!source) return '—';
  // Normalize common kinds → human label.
  if (source.startsWith('slack')) return 'Slack';
  if (source.startsWith('github')) return 'GitHub';
  if (source.startsWith('notion')) return 'Notion';
  if (source.startsWith('grain')) return 'Grain';
  if (source.startsWith('pylon')) return 'Pylon';
  if (source.startsWith('hubspot')) return 'HubSpot';
  if (source.startsWith('salesforce')) return 'Salesforce';
  if (source.startsWith('webcrawl')) return 'Web';
  if (source.startsWith('mintlify')) return 'Mintlify';
  if (source.startsWith('prismic')) return 'Prismic';
  if (source.startsWith('stripe')) return 'Stripe';
  if (source.startsWith('zendesk')) return 'Zendesk';
  if (source.startsWith('linear')) return 'Linear';
  if (source.startsWith('openapi')) return 'OpenAPI';
  if (source === 'google-chat') return 'Google Chat';
  return source[0]!.toUpperCase() + source.slice(1);
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${gb < 10 ? gb.toFixed(1) : Math.round(gb)} GB`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hours ago`;
  if (sec < 604800) {
    const d = Math.floor(sec / 86400);
    return d === 1 ? 'Yesterday' : `${d} days ago`;
  }
  if (sec < 2592000) return `${Math.floor(sec / 604800)} weeks ago`;
  return new Date(iso).toLocaleDateString();
}

function pathSegments(path: string): string[] {
  if (path === '/') return [];
  return path.split('/').filter(Boolean);
}

export function FileExplorer({ initialPath }: { initialPath: string }) {
  const router = useRouter();
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirChild[] | null>(null);
  const [listError, setListError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>({ column: 'name', direction: 'asc' });

  // Viewer state — sheet slides in from the right when a file is clicked.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [openFile, setOpenFile] = useState<ContentResponse | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  const [openError, setOpenError] = useState<ApiError | null>(null);

  useEffect(() => {
    setPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setListError(null);
    setPage(0);
    fetch(`/api/files?path=${encodeURIComponent(path)}&limit=1000`, {
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw (await r.json()) as ApiError;
        return (await r.json()) as ListResponse;
      })
      .then((res) => setEntries(res.entries))
      .catch((err) => {
        if (ac.signal.aborted) return;
        setListError(
          typeof err === 'object' && err && 'problem' in err
            ? (err as ApiError)
            : { problem: String(err) },
        );
        setEntries([]);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [path]);

  const segments = useMemo(() => pathSegments(path), [path]);

  // Folders always at the top, then files. Within each group apply the
  // chosen column sort so directory listings stay scannable.
  const sortedEntries = useMemo(() => {
    if (!entries) return null;
    const folders = entries.filter((e) => e.type === 'directory');
    const files = entries.filter((e) => e.type === 'file');
    folders.sort((a, b) => compareEntries(a, b, sort));
    files.sort((a, b) => compareEntries(a, b, sort));
    return [...folders, ...files];
  }, [entries, sort]);

  const totalEntries = sortedEntries?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const pageEntries = useMemo(
    () => sortedEntries?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [],
    [sortedEntries, page],
  );

  const onSortClick = useCallback((column: SortColumn) => {
    setPage(0);
    setSort((prev) => {
      if (prev.column === column) {
        return { column, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      // First click on a new column picks the more useful default:
      // names ascend, timestamps descend (newest first).
      return {
        column,
        direction: column === 'updatedAt' || column === 'size' ? 'desc' : 'asc',
      };
    });
  }, []);

  const navigateTo = useCallback(
    (newPath: string) => {
      const url =
        newPath === '/'
          ? '/files'
          : '/files/' +
            newPath.split('/').filter(Boolean).map(encodeURIComponent).join('/');
      router.push(url);
      setPath(newPath);
    },
    [router],
  );

  const onRowClick = useCallback(
    async (entry: DirChild) => {
      if (entry.type === 'directory') {
        navigateTo(path === '/' ? `/${entry.name}` : `${path}/${entry.name}`);
        return;
      }
      const filePath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
      setViewerOpen(true);
      setOpenLoading(true);
      setOpenError(null);
      setOpenFile(null);
      try {
        const r = await fetch(
          `/api/files/content?path=${encodeURIComponent(filePath)}`,
        );
        if (!r.ok) {
          setOpenError((await r.json()) as ApiError);
        } else {
          setOpenFile((await r.json()) as ContentResponse);
        }
      } catch (err) {
        setOpenError({ problem: String(err) });
      } finally {
        setOpenLoading(false);
      }
    },
    [navigateTo, path],
  );

  return (
    <div className="px-6 py-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-h1 font-semibold">Files</h1>
          <p className="text-body-small text-text-muted mt-1">
            Browse everything Holo has synced. Read-only — the same view your
            agents see via <code className="font-mono text-mono">bash</code>.
          </p>
        </div>
      </header>

      <Breadcrumb segments={segments} onNavigate={navigateTo} />

      <div className="border border-border rounded-md overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_100px_180px] gap-4 px-4 py-2 text-caption text-text-subtle border-b border-border bg-surface">
          <SortHeader label="Name" column="name" sort={sort} onClick={onSortClick} />
          <SortHeader label="Source" column="source" sort={sort} onClick={onSortClick} />
          <SortHeader label="Size" column="size" sort={sort} onClick={onSortClick} />
          <SortHeader label="Synced" column="updatedAt" sort={sort} onClick={onSortClick} />
        </div>

        {loading && (
          <div className="px-4 py-6 text-text-muted text-body-small">Loading…</div>
        )}

        {!loading && listError && (
          <div className="px-4 py-6 text-error text-body-small">
            {listError.problem}
            {listError.fix && (
              <div className="text-text-muted mt-1">{listError.fix}</div>
            )}
          </div>
        )}

        {!loading && !listError && entries && entries.length === 0 && (
          <div className="px-4 py-6 text-text-muted text-body-small">
            Empty. Either nothing has been synced under this path yet, or
            you don't have access to anything here.
          </div>
        )}

        {!loading && !listError && entries && entries.length > 0 && (
          <ul>
            {pageEntries.map((entry) => {
              const Icon = iconForEntry(entry);
              return (
                <li
                  key={entry.name}
                  className="grid grid-cols-[1fr_140px_100px_180px] gap-4 px-4 py-3 items-center border-b border-border last:border-b-0 hover:bg-surface cursor-pointer transition-colors"
                  onClick={() => onRowClick(entry)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon
                      className={`shrink-0 ${entry.type === 'directory' ? 'text-accent' : 'text-text-muted'}`}
                      size={18}
                    />
                    <span className="truncate text-body text-text">
                      {entry.name}
                    </span>
                  </div>
                  <div className="text-body-small text-text-muted">
                    {entry.type === 'file' ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-2 text-caption text-text-muted">
                        {prettySource(entry.source)}
                      </span>
                    ) : (
                      <span className="text-text-subtle">—</span>
                    )}
                  </div>
                  <div className="text-body-small text-text-muted tabular-nums">
                    {formatBytes(entry.sizeBytes)}
                  </div>
                  <div className="text-body-small text-text-muted tabular-nums">
                    {relativeTime(entry.updatedAt)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!loading && !listError && totalEntries > PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalEntries={totalEntries}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      )}

      <Sheet open={viewerOpen} onOpenChange={setViewerOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="font-mono text-[13px] truncate pr-8">
              {openFile?.path ?? '…'}
            </SheetTitle>
            <SheetDescription className="text-caption tabular-nums">
              {openFile ? (
                <>
                  {prettySource(openFile.kind)} · {relativeTime(openFile.updatedAt)}
                </>
              ) : (
                'Loading…'
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {openLoading && (
              <div className="text-body-small text-text-muted">Loading file…</div>
            )}
            {openError && (
              <div className="text-error text-body-small">
                {openError.problem}
                {openError.fix && (
                  <div className="text-text-muted mt-1">{openError.fix}</div>
                )}
              </div>
            )}
            {openFile && !openLoading && (
              <div className="text-body text-text">
                <Markdown text={openFile.content} />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SortHeader({
  label,
  column,
  sort,
  onClick,
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onClick: (column: SortColumn) => void;
}) {
  const isActive = sort.column === column;
  const Arrow = sort.direction === 'asc' ? ChevronUpIcon : ChevronDownIcon;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 hover:text-text transition-colors ${
        isActive ? 'text-text' : ''
      }`}
      onClick={() => onClick(column)}
    >
      <span>{label}</span>
      {isActive && <Arrow size={12} className="text-text-muted" />}
    </button>
  );
}

function Pagination({
  page,
  totalPages,
  totalEntries,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalEntries: number;
  pageSize: number;
  onChange: (next: number) => void;
}) {
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalEntries);
  return (
    <div className="flex items-center justify-between text-body-small text-text-muted">
      <div className="tabular-nums">
        {start.toLocaleString()}–{end.toLocaleString()} of{' '}
        {totalEntries.toLocaleString()}
        {totalEntries >= 1000 && ' (capped)'}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-text-muted hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          onClick={() => onChange(Math.max(0, page - 1))}
          disabled={page === 0}
        >
          <ChevronLeftIcon size={14} />
          Prev
        </button>
        <span className="px-2 tabular-nums text-text-subtle">
          {page + 1} / {totalPages}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-text-muted hover:bg-surface disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
          onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
          disabled={page >= totalPages - 1}
        >
          Next
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  );
}

function Breadcrumb({
  segments,
  onNavigate,
}: {
  segments: string[];
  onNavigate: (path: string) => void;
}) {
  return (
    <nav className="flex items-center gap-1 text-body-small text-text-muted">
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-text transition-colors"
        onClick={() => onNavigate('/')}
      >
        <HomeIcon size={14} />
        <span>Home</span>
      </button>
      {segments.map((seg, i) => {
        const subPath = '/' + segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <span key={subPath} className="flex items-center gap-1">
            <ChevronRightIcon size={14} className="text-text-subtle" />
            {isLast ? (
              <span className="text-text font-medium">{seg}</span>
            ) : (
              <button
                type="button"
                className="hover:text-text transition-colors"
                onClick={() => onNavigate(subPath)}
              >
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
