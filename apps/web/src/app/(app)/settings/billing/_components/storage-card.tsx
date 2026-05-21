interface Props {
  currentCount: number;
  limit: number | null;
  currentPlanName: string;
  suggestedUpgradeSlug: string | null;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
  return n.toLocaleString('en-US');
}

/**
 * "Indexed items" card — counterpart to BalanceCard. Surfaces the plan's
 * `maxStoredArtifacts` ceiling vs. the org's actual `chunks` row count, with
 * a progress bar and graduated warnings.
 *
 * Visual rules (DESIGN.md):
 *   - JetBrains Mono + tabular-nums on the count (data, not decoration).
 *   - Progress bar uses `--text-subtle` fill, NOT `--accent` — BalanceCard's
 *     bar already owns the page's single accent use.
 *   - Status row colour shifts: muted < 80%, warning ≥ 80%, error at 100%.
 *
 * "Item" = one row in the `chunks` table (one embedding vector). The footer
 * tooltip explains the unit since it's not obvious from the UI alone.
 */
export function StorageCard({
  currentCount,
  limit,
  currentPlanName,
  suggestedUpgradeSlug,
}: Props) {
  const isUnlimited = limit === null;
  const ratio = isUnlimited ? 0 : limit === 0 ? 1 : Math.min(1, currentCount / limit);
  const atCap = !isUnlimited && currentCount >= (limit ?? 0);
  const nearCap = !isUnlimited && !atCap && ratio >= 0.9;

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Indexed items</h3>
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="flex items-baseline gap-2">
          <div className="font-mono text-[36px] leading-[44px] font-medium tabular-nums text-text">
            {formatCount(currentCount)}
          </div>
          {!isUnlimited ? (
            <div className="font-mono text-[20px] leading-[44px] tabular-nums text-text-muted">
              / {formatCount(limit)}
            </div>
          ) : (
            <span className="ml-1 inline-flex items-center rounded-sm bg-surface-2 px-2 py-0.5 text-[11px] uppercase tracking-[0.06em] text-text-muted">
              Unlimited
            </span>
          )}
        </div>
        <p className="mt-2 text-[13px] text-text-muted">
          chunks in your search index ·{' '}
          <span title="Each item is one chunk in the search index. A typical Notion page is 5–20 chunks; a long PDF is ~150." className="underline decoration-text-subtle decoration-dotted underline-offset-2">
            what counts?
          </span>
        </p>

        {!isUnlimited ? (
          <div className="mt-5 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
              <div
                className="h-full bg-text-subtle"
                style={{ width: `${(ratio * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="flex justify-between text-[12px] tabular-nums text-text-muted">
              <span>
                {(ratio * 100).toFixed(ratio === 0 || ratio === 1 ? 0 : 1)}% used
              </span>
              <span>on {currentPlanName}</span>
            </div>
          </div>
        ) : null}

        {atCap ? (
          <div className="mt-5 rounded-md border border-danger/40 bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-4 py-3 text-[13px] text-text">
            <span className="font-medium">Storage full.</span> New ingestion is
            paused; existing items stay queryable.
            {suggestedUpgradeSlug ? (
              <>
                {' '}
                <a
                  href={`/settings/billing?upgrade=${suggestedUpgradeSlug}#plans`}
                  className="font-medium underline underline-offset-2 hover:no-underline"
                >
                  Upgrade
                </a>{' '}
                to resume.
              </>
            ) : null}
          </div>
        ) : nearCap ? (
          <div className="mt-5 rounded-md border border-warning/40 bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] px-4 py-3 text-[13px] text-text-muted">
            Approaching your plan&apos;s limit. Ingestion will pause at the cap.
            {suggestedUpgradeSlug ? (
              <>
                {' '}
                <a
                  href={`/settings/billing?upgrade=${suggestedUpgradeSlug}#plans`}
                  className="font-medium text-text underline underline-offset-2 hover:no-underline"
                >
                  Upgrade
                </a>
                .
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
