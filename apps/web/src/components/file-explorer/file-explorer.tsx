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
  HomeIcon,
} from 'lucide-react';

interface DirChild {
  name: string;
  type: 'file' | 'directory';
  source: string | null;
  updatedAt: string | null;
  kind: string | null;
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

  // Detail-pane state — when a file row is clicked, fetch + render.
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
    setOpenFile(null);
    setOpenError(null);
    fetch(`/api/files?path=${encodeURIComponent(path)}&limit=500`, {
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
        <div className="grid grid-cols-[1fr_140px_180px] gap-4 px-4 py-2 text-caption text-text-subtle border-b border-border bg-surface">
          <div>Name</div>
          <div>Source</div>
          <div>Synced</div>
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
            {entries.map((entry) => {
              const Icon = iconForEntry(entry);
              return (
                <li
                  key={entry.name}
                  className="grid grid-cols-[1fr_140px_180px] gap-4 px-4 py-3 items-center border-b border-border last:border-b-0 hover:bg-surface cursor-pointer transition-colors"
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
                    {relativeTime(entry.updatedAt)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(openLoading || openError || openFile) && (
        <div className="border border-border rounded-md p-4 space-y-2 bg-surface">
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
          {openFile && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="font-mono text-caption text-text-subtle truncate">
                  {openFile.path}
                </div>
                <div className="text-caption text-text-subtle tabular-nums shrink-0">
                  {prettySource(openFile.kind)} · {relativeTime(openFile.updatedAt)}
                </div>
              </div>
              <pre className="whitespace-pre-wrap font-mono text-body-small text-text bg-bg p-3 rounded border border-border overflow-x-auto">
                {openFile.content}
              </pre>
            </div>
          )}
        </div>
      )}
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
