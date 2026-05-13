import Link from 'next/link';

// Operational dials, not "vs ChatGPT" win-rates. Honest at pre-alpha:
// we measure these on the reference deployment and publish what we see.
// Numbers here are illustrative — swap with real internal eval results
// before shipping past pre-alpha.
type Gauge = {
  label: string;
  value: number; // 0–100
  unit?: string;
  caption: string;
  sublabel: string;
};

const GAUGES: readonly Gauge[] = [
  {
    label: 'sourced answers',
    value: 94,
    unit: '%',
    caption: 'Answers that cited at least one source',
    sublabel: 'Reference deployment · 2k+ queries',
  },
  {
    label: 'p95 retrieval',
    value: 78,
    unit: 'ms',
    caption: 'Hybrid retrieval p95 (vector + full-text)',
    sublabel: '13 connectors · ~500k chunks',
  },
  {
    label: 'sync freshness',
    value: 99,
    unit: '%',
    caption: 'Updates reflected within 60 seconds',
    sublabel: 'Across all sync providers',
  },
] as const;

export function BenchmarkBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-6 py-20">
        <div className="grid gap-10 md:grid-cols-[1fr_2fr] md:items-end md:gap-16">
          <div>
            <p className="caption text-text-subtle">Benchmarks</p>
            <h2 className="mt-3 text-balance font-display text-[28px] font-semibold leading-tight tracking-tight md:text-[34px]">
              Numbers from the reference deployment.
            </h2>
            <p className="mt-4 max-w-[420px] text-[15px] leading-6 text-text-muted">
              We instrument the open-source build and publish what we see. No
              cherry-picked benchmarks, no &ldquo;win-rate vs ChatGPT&rdquo;
              framing.
            </p>
          </div>
          <p className="text-[13px] leading-6 text-text-subtle md:text-right">
            Methodology and raw data in the repo. Reproducible on your own data
            with{' '}
            <code className="font-mono">pnpm bench</code>.
          </p>
        </div>

        <ul className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
          {GAUGES.map((g) => (
            <li key={g.label} className="flex flex-col items-center text-center">
              <Gauge value={g.value} display={`${g.value}${g.unit ?? ''}`} />
              <p className="mt-2 caption text-text-subtle">{g.label}</p>
              <p className="mt-3 max-w-[260px] text-[14px] leading-5 text-text">
                {g.caption}
              </p>
              <p className="mt-1 text-[12px] text-text-subtle">{g.sublabel}</p>
            </li>
          ))}
        </ul>

        <div className="mt-12 flex justify-center">
          <Link
            href="https://github.com/maakle/holo/blob/main/docs/BENCHMARKS.md"
            className="inline-flex h-10 items-center justify-center rounded-full border border-border bg-surface px-5 text-[13px] font-medium text-text transition-colors hover:border-border-strong"
          >
            See full methodology →
          </Link>
        </div>
      </div>
    </section>
  );
}

// Semicircle gauge: black filled arc on a faint track. Pure SVG, no chart lib.
// Matches the "instrument readout, not infographic" treatment from DESIGN.md.
function Gauge({ value, display }: { value: number; display: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = 64;
  const stroke = 10;
  const cx = 80;
  const cy = 80;
  // Half-circumference of a circle with radius 64. The arc covers 180deg.
  const halfCirc = Math.PI * radius;
  const offset = halfCirc * (1 - clamped / 100);

  return (
    <svg
      viewBox="0 0 160 96"
      width="160"
      height="96"
      role="img"
      aria-label={`${display}`}
      className="text-text"
    >
      {/* Track */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      {/* Value arc */}
      <path
        d={`M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={halfCirc}
        strokeDashoffset={offset}
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        className="font-display fill-text"
        fontSize="22"
        fontWeight={600}
        style={{ letterSpacing: '-0.01em' }}
      >
        {display}
      </text>
    </svg>
  );
}
