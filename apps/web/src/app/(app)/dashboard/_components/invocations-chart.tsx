'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

export interface InvocationsBucket {
  bucket: string; // ISO
  ok: number;
  errors: number;
}

const config = {
  ok: { label: 'OK', color: 'var(--accent)' },
  errors: { label: 'Errors', color: 'var(--error)' },
} satisfies ChartConfig;

export function InvocationsChart({ data }: { data: InvocationsBucket[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
      <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 2" />
        <XAxis
          dataKey="bucket"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={fmtDay}
          fontSize={11}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tickMargin={4}
          width={28}
          fontSize={11}
          allowDecimals={false}
        />
        <ChartTooltip
          cursor={{ fill: 'var(--surface-2)' }}
          content={<ChartTooltipContent labelFormatter={(v) => fmtFull(v as string)} />}
        />
        <Bar dataKey="ok" stackId="a" fill="var(--color-ok)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="errors" stackId="a" fill="var(--color-errors)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

function fmtDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtFull(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
