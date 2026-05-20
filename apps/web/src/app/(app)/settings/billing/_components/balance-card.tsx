interface Props {
  balance: number;
  monthlyGrant: number;
  debitsThisPeriod: number;
}

function formatCredits(n: number): string {
  return n.toLocaleString('en-US');
}

export function BalanceCard({ balance, monthlyGrant, debitsThisPeriod }: Props) {
  // Period usage as a fraction of the monthly grant. Clamp so the bar can't
  // overflow visually if a topup pushes spend > grant.
  const ratio =
    monthlyGrant > 0 ? Math.min(1, debitsThisPeriod / monthlyGrant) : 0;

  return (
    <section className="space-y-3">
      <h3 className="text-[15px] font-medium text-text">Credit balance</h3>
      <div className="rounded-md border border-border bg-surface p-6">
        <div className="font-mono text-[36px] leading-[44px] font-medium tabular-nums text-text">
          {formatCredits(balance)}
        </div>
        <p className="mt-2 text-[13px] text-text-muted">
          credits remaining
        </p>

        {monthlyGrant > 0 ? (
          <div className="mt-5 space-y-2">
            <div className="h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
              <div
                className="h-full bg-accent"
                style={{ width: `${(ratio * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="flex justify-between text-[12px] tabular-nums text-text-muted">
              <span>
                {formatCredits(debitsThisPeriod)} used this period
              </span>
              <span>{formatCredits(monthlyGrant)} included monthly</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
