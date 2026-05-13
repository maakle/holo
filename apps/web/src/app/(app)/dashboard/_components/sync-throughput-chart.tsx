'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export type SyncBucket = { bucket: string } & Record<string, string | number>;

// Provider color order — accent first, then neutral grayscale ramp.
// Keeps to DESIGN.md restraint: one accent, rest are tonal neutrals.
const PROVIDER_COLORS = [
  'var(--accent)',
  '#A1A1AA', // text-muted
  '#71717A', // text-subtle
  '#3F3F46', // border-strong (dark) / mid neutral
  '#D4D4D8',
];

export function SyncThroughputChart({
  data,
  providers,
}: {
  data: SyncBucket[];
  providers: string[];
}) {
  const config: ChartConfig = Object.fromEntries(
    providers.map((p, i) => [
      p,
      {
        label: p === 'other' ? 'Other' : p,
        color: p === 'other' ? '#52525B' : PROVIDER_COLORS[i % PROVIDER_COLORS.length],
      },
    ]),
  );

  return (
    <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 2" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={fmtDay}
          fontSize={11}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={36}
          fontSize={11}
          allowDecimals={false}
          tickFormatter={fmtCount}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={<ChartTooltipContent labelFormatter={(v) => fmtDay(v as string)} />}
        />
        <ChartLegend content={<ChartLegendContent />} />
        {providers.map((p, i) => (
          <Bar
            key={p}
            dataKey={p}
            stackId="a"
            fill={`var(--color-${p})`}
            radius={i === providers.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtCount(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return `${v}`;
}
