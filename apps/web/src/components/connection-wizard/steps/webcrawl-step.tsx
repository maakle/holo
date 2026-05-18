'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

// Server-side route enforces these too; client mirrors them so the user
// gets immediate feedback instead of a round-trip rejection.
const MAX_SCRAPE_URLS = 20;
const MAX_CRAWL_LIMIT = 500;
const MAX_CRAWL_DEPTH = 5;
const MAX_PATH_FILTERS = 20;

type Mode = 'scrape' | 'crawl';

export function webcrawlStep<TState>(ctx: WizardContext<TState>) {
  return <WebcrawlStep ctx={ctx} />;
}

function WebcrawlStep<TState>({ ctx }: { ctx: WizardContext<TState> }) {
  const { meta, connected, connectedAs, forceCredentialEntry } = ctx;
  const showConnectedBanner = connected && !forceCredentialEntry;
  const isReconnect = Boolean(forceCredentialEntry);

  const [mode, setMode] = useState<Mode>('scrape');
  const [urlsText, setUrlsText] = useState('');
  const [seedUrl, setSeedUrl] = useState('');
  const [limit, setLimit] = useState(50);
  const [maxDepth, setMaxDepth] = useState(2);
  const [includePathsText, setIncludePathsText] = useState('');
  const [excludePathsText, setExcludePathsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On reconnect (Manage → Reconnect), load the existing source(s) so the
  // form pre-fills with whatever was last saved. The form is then a true
  // edit surface — submit replaces the saved state (see `replace: true`
  // below), so switching mode crawl↔scrape can't leave the old row behind.
  useEffect(() => {
    if (!isReconnect) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/connectors/${meta.id}/connect`, { method: 'GET' });
        if (!res.ok) return;
        const json = (await res.json().catch(() => ({}))) as {
          sources?: Array<{ externalId: string; metadata: Record<string, unknown> | null }>;
        };
        if (cancelled || !json.sources || json.sources.length === 0) return;

        // A crawl row pins the mode (one seed per connector — the wizard
        // only writes a single crawl row). Otherwise treat everything as
        // scrape URLs and concatenate them into the textarea.
        const crawl = json.sources.find(
          (s) => (s.metadata as { mode?: string } | null)?.mode === 'crawl',
        );
        if (crawl) {
          const md = crawl.metadata as {
            seedUrl?: string;
            limit?: number;
            maxDepth?: number;
            includePaths?: string[];
            excludePaths?: string[];
          } | null;
          setMode('crawl');
          if (md?.seedUrl) setSeedUrl(md.seedUrl);
          if (typeof md?.limit === 'number') setLimit(md.limit);
          if (typeof md?.maxDepth === 'number') setMaxDepth(md.maxDepth);
          if (md?.includePaths?.length) setIncludePathsText(md.includePaths.join('\n'));
          if (md?.excludePaths?.length) setExcludePathsText(md.excludePaths.join('\n'));
        } else {
          const urls = json.sources
            .map((s) => (s.metadata as { url?: string } | null)?.url ?? s.externalId)
            .filter((u): u is string => typeof u === 'string' && u.length > 0);
          if (urls.length > 0) {
            setMode('scrape');
            setUrlsText(urls.join('\n'));
          }
        }
      } catch {
        // Pre-fill is best-effort; a fetch failure just leaves the form
        // blank, which matches the pre-fix behaviour.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isReconnect, meta.id]);

  const urls = parseLines(urlsText);
  const includePaths = parseLines(includePathsText);
  const excludePaths = parseLines(excludePathsText);

  const canSubmit =
    mode === 'scrape'
      ? urls.length > 0 && urls.length <= MAX_SCRAPE_URLS
      : seedUrl.trim().length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Reconnect submits replace the saved state — without this the
      // server upserts by (org, provider, externalId), so e.g. switching
      // from a crawl of midlane.com to a scrape of midlane.com/pricing
      // would leave the original crawl row in place and keep syncing both.
      const body =
        mode === 'scrape'
          ? { mode: 'scrape', urls, ...(isReconnect ? { replace: true } : {}) }
          : {
              mode: 'crawl',
              seedUrl: seedUrl.trim(),
              limit,
              maxDepth,
              ...(includePaths.length > 0 ? { includePaths } : {}),
              ...(excludePaths.length > 0 ? { excludePaths } : {}),
              ...(isReconnect ? { replace: true } : {}),
            };
      const res = await fetch(`/api/connectors/${meta.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(json.fix ?? json.problem ?? 'Connection failed');
        return;
      }
      toast.success(`${meta.displayName} connected`);
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {showConnectedBanner ? (
        <div className="rounded-md border border-success/40 bg-[color-mix(in_srgb,var(--success,#16a34a)_8%,transparent)] px-3 py-2 text-[13px] text-text">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" aria-hidden />
            <span className="font-medium">{meta.displayName} connected</span>
          </div>
          {connectedAs ? (
            <p className="mt-1 text-text-muted">
              Connected as <span className="font-medium text-text">{connectedAs}</span>.
            </p>
          ) : null}
          <p className="mt-1 text-text-muted">
            Re-open this wizard to add more URLs or crawls — each one syncs independently.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-text-muted">
            Pick a list of specific URLs to scrape, or seed a full crawl from a starting page. Firecrawl powers both modes.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <ModeCard
              active={mode === 'scrape'}
              title="Scrape URLs"
              description="One or more specific pages. Cheapest option."
              onClick={() => setMode('scrape')}
            />
            <ModeCard
              active={mode === 'crawl'}
              title="Crawl site"
              description="Seed URL + follow links up to a limit."
              onClick={() => setMode('crawl')}
            />
          </div>

          {mode === 'scrape' ? (
            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-text-muted">
                URLs — one per line (up to {MAX_SCRAPE_URLS})
              </span>
              <textarea
                value={urlsText}
                onChange={(e) => {
                  setUrlsText(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={'https://example.com/pricing\nhttps://example.com/docs/quickstart'}
                rows={6}
                className="w-full rounded-md border border-border bg-bg p-3 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
                spellCheck={false}
                disabled={busy}
              />
              <span className="text-[11px] text-text-subtle">
                {urls.length} URL{urls.length === 1 ? '' : 's'}
                {urls.length > MAX_SCRAPE_URLS
                  ? ` — too many, max ${MAX_SCRAPE_URLS}`
                  : ''}
              </span>
            </label>
          ) : (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-text-muted">Seed URL</span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://example.com/docs"
                  value={seedUrl}
                  onChange={(e) => {
                    setSeedUrl(e.target.value);
                    if (error) setError(null);
                  }}
                  className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-3 text-[13px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-text-muted">
                    Page limit (max {MAX_CRAWL_LIMIT})
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_CRAWL_LIMIT}
                    value={limit}
                    onChange={(e) =>
                      setLimit(clampInt(e.target.value, 1, MAX_CRAWL_LIMIT, 50))
                    }
                    className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-3 text-[13px] text-text focus:outline-hidden focus:focus-ring"
                    disabled={busy}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] text-text-muted">
                    Max depth (0–{MAX_CRAWL_DEPTH})
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_CRAWL_DEPTH}
                    value={maxDepth}
                    onChange={(e) =>
                      setMaxDepth(clampInt(e.target.value, 0, MAX_CRAWL_DEPTH, 2))
                    }
                    className="w-full rounded-md border border-border bg-bg py-2 pl-3 pr-3 text-[13px] text-text focus:outline-hidden focus:focus-ring"
                    disabled={busy}
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-text-muted">
                  Include paths (optional) — one glob per line, e.g. <code>/docs/*</code>
                </span>
                <textarea
                  value={includePathsText}
                  onChange={(e) => setIncludePathsText(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-bg p-2 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
                  spellCheck={false}
                  disabled={busy}
                  placeholder="/docs/*"
                />
                {includePaths.length > MAX_PATH_FILTERS ? (
                  <span className="text-[11px] text-error">
                    Max {MAX_PATH_FILTERS} include patterns.
                  </span>
                ) : null}
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[12px] text-text-muted">
                  Exclude paths (optional)
                </span>
                <textarea
                  value={excludePathsText}
                  onChange={(e) => setExcludePathsText(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-border bg-bg p-2 font-mono text-[12px] text-text placeholder:text-text-subtle focus:outline-hidden focus:focus-ring"
                  spellCheck={false}
                  disabled={busy}
                  placeholder="/blog/*"
                />
                {excludePaths.length > MAX_PATH_FILTERS ? (
                  <span className="text-[11px] text-error">
                    Max {MAX_PATH_FILTERS} exclude patterns.
                  </span>
                ) : null}
              </label>
            </div>
          )}

          {error ? <p className="text-[12px] text-error">{error}</p> : null}
        </div>
      )}
      <AlertDialogFooter>
        {showConnectedBanner ? (
          <Button variant="primary" onClick={ctx.goNext}>
            Continue
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={ctx.close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={busy || !canSubmit}>
              {busy ? 'Connecting…' : 'Connect'}
            </Button>
          </>
        )}
      </AlertDialogFooter>
    </>
  );
}

function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-[13px] transition-colors focus:outline-hidden focus:focus-ring ${
        active
          ? 'border-accent bg-[color-mix(in_srgb,var(--accent,#3F47FF)_8%,transparent)] text-text'
          : 'border-border bg-bg text-text-muted hover:text-text'
      }`}
    >
      <span className="font-medium text-text">{title}</span>
      <span className="text-[12px] text-text-muted">{description}</span>
    </button>
  );
}

function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
