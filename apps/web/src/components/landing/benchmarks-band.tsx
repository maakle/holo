import { ArrowRight } from 'lucide-react';

type GaugeData = {
  value: number;
  unit: '%' | 'ms';
  label: string;
  desc: string;
  meta: string;
};

const GAUGES: GaugeData[] = [
  {
    value: 94,
    unit: '%',
    label: 'sourced answers',
    desc: 'Answers that cited at least one source',
    meta: 'Reference deployment · 2k+ queries',
  },
  {
    value: 78,
    unit: 'ms',
    label: 'p95 retrieval',
    desc: 'Hybrid retrieval p95 (vector + full-text)',
    meta: '13 connectors · ~500k chunks',
  },
  {
    value: 99,
    unit: '%',
    label: 'sync freshness',
    desc: 'Updates reflected within 60 seconds',
    meta: 'Across all sync providers',
  },
];

function Gauge({ value, unit }: { value: number; unit: '%' | 'ms' }) {
  // ms gauges read inversely: faster = fuller
  const filled =
    unit === 'ms'
      ? Math.max(0, Math.min(100, 100 - value / 2))
      : Math.max(0, Math.min(100, value));
  const r = 70;
  const cx = 90;
  const cy = 90;
  const stroke = 10;
  const half = Math.PI * r;
  const offset = half * (1 - filled / 100);
  return (
    <svg viewBox="0 0 180 110" width="180" height="110" role="img" aria-hidden className="block">
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
        strokeLinecap="round"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke="var(--text)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={half}
        strokeDashoffset={offset}
      />
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fill="var(--text)"
        fontSize="34"
        fontWeight="600"
        style={{ letterSpacing: '-0.02em' }}
      >
        {value}
        <tspan fontSize="18" dx="2" style={{ letterSpacing: 0 }}>
          {unit}
        </tspan>
      </text>
    </svg>
  );
}

type CompareRow = {
  metric: string;
  holo: string;
  other: string;
  note: string;
};

const COMPARE: CompareRow[] = [
  {
    metric: 'Hybrid retrieval p95',
    holo: '78ms',
    other: '210ms',
    note: 'vector + tsvector',
  },
  {
    metric: 'Per-call audit attribution',
    holo: 'always',
    other: 'opt-in',
    note: 'agent + user + scope',
  },
  {
    metric: 'ACL-aware sync',
    holo: 'ingest',
    other: 'query-time',
    note: 'no row-level leakage',
  },
  {
    metric: 'Connectors live',
    holo: '20',
    other: '8–12',
    note: 'community-extensible',
  },
];

export function BenchmarksBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-[1280px] px-8 py-24">
        <div className="mb-14 grid items-end gap-16 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="caption text-text-subtle">Benchmarks</p>
            <h2
              className="mt-3.5 font-display font-semibold text-text"
              style={{
                fontSize: 'clamp(34px, 4vw, 52px)',
                lineHeight: 1.05,
                letterSpacing: '-0.015em',
                textWrap: 'balance',
              }}
            >
              Numbers from the reference deployment.
            </h2>
          </div>
          <div>
            <p className="max-w-[520px] text-[15px] leading-[1.55] text-text-muted">
              We instrument the open-source build and publish what we see. No cherry-picked
              benchmarks, no &quot;win-rate vs ChatGPT&quot; framing.
            </p>
            <p className="mt-3 font-mono text-[12px] text-text-subtle">
              Reproducible on your own data with <code>pnpm bench</code>.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {GAUGES.map((g) => (
            <div
              key={g.label}
              className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 pb-6 pt-8 text-center"
            >
              <Gauge value={g.value} unit={g.unit} />
              <p className="caption mt-1 text-text-subtle">{g.label}</p>
              <p className="mt-3 max-w-[260px] text-[14px] leading-5 text-text">{g.desc}</p>
              <p className="mt-1.5 text-[12px] text-text-subtle">{g.meta}</p>
            </div>
          ))}
        </div>

        {/* Head-to-head comparison */}
        <div className="mt-8 overflow-hidden rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-3.5">
            <p className="caption text-text-subtle">Head-to-head</p>
            <p className="text-[12px] text-text-subtle">
              vs typical proprietary context layer · public benchmarks
            </p>
          </div>
          <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr' }}>
            {['Metric', 'Holo', 'Proprietary', 'Notes'].map((h) => (
              <div
                key={h}
                className="caption border-b border-border bg-surface-2 px-5 py-3 text-text-subtle"
              >
                {h}
              </div>
            ))}
            {COMPARE.map((row, i) => {
              const last = i === COMPARE.length - 1;
              const cell = `px-5 py-3.5 ${last ? '' : 'border-b border-border'}`;
              return (
                <div key={row.metric} className="contents">
                  <div className={`${cell} text-[14px] text-text`}>{row.metric}</div>
                  <div
                    className={`${cell} flex items-center gap-2 font-mono text-[14px] text-text`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    {row.holo}
                  </div>
                  <div className={`${cell} font-mono text-[14px] text-text-muted`}>
                    {row.other}
                  </div>
                  <div className={`${cell} text-[13px] text-text-subtle`}>{row.note}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-8">
          <a
            href="https://github.com/maakle/holo/blob/main/docs/BENCHMARKS.md"
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-text transition-colors hover:text-accent"
          >
            See full methodology
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
