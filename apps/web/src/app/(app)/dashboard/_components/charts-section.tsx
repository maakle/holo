import { and, eq, gte, sql } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InvocationsChart, type InvocationsBucket } from './invocations-chart';
import { SyncThroughputChart, type SyncBucket } from './sync-throughput-chart';
import { RangePicker, type Range } from './range-picker';

const CONFIG: Record<Range, { rangeHours: number; bucketHours: number; bucketLabel: string }> = {
  '7d': { rangeHours: 24 * 7, bucketHours: 6, bucketLabel: '6h buckets' },
  '30d': { rangeHours: 24 * 30, bucketHours: 24, bucketLabel: 'daily' },
};

export async function ChartsSection({ orgId, range }: { orgId: string; range: Range }) {
  const { db } = await getServerContext();
  const { rangeHours, bucketHours, bucketLabel } = CONFIG[range];
  const since = new Date(Date.now() - rangeHours * 60 * 60 * 1000);
  const rangeDays = Math.round(rangeHours / 24);

  const [invocationRows, syncRows] = await Promise.all([
    db
      .select({
        bucket: sql<Date>`date_trunc('hour', ${schema.mcpInvocations.createdAt})
          - make_interval(hours => extract(hour from ${schema.mcpInvocations.createdAt})::int % ${bucketHours})`.as('bucket'),
        ok: sql<number>`sum(case when ${schema.mcpInvocations.errorCode} is null then 1 else 0 end)::int`.as('ok'),
        errors: sql<number>`sum(case when ${schema.mcpInvocations.errorCode} is not null then 1 else 0 end)::int`.as('errors'),
      })
      .from(schema.mcpInvocations)
      .where(
        and(
          eq(schema.mcpInvocations.organizationId, orgId),
          gte(schema.mcpInvocations.createdAt, since),
        ),
      )
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`),
    db
      .select({
        bucket: sql<Date>`date_trunc('day', ${schema.syncRuns.startedAt})`.as('bucket'),
        provider: schema.syncRuns.provider,
        records: sql<number>`coalesce(sum(${schema.syncRuns.artifactCount}), 0)::int`.as('records'),
      })
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.organizationId, orgId),
          gte(schema.syncRuns.startedAt, since),
          eq(schema.syncRuns.status, 'ok'),
        ),
      )
      .groupBy(sql`bucket`, schema.syncRuns.provider)
      .orderBy(sql`bucket`),
  ]);

  const invocationBuckets = fillInvocationBuckets(invocationRows, since, bucketHours);
  const { buckets: syncBuckets, providers } = pivotSyncRows(syncRows, since);

  const hasInvocations = invocationBuckets.some((b) => b.ok + b.errors > 0);
  const hasSyncs = syncBuckets.some((b) =>
    providers.some((p) => (b[p] as number | undefined) ?? 0 > 0),
  );

  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Invocations</CardTitle>
              <CardDescription>Last {rangeDays} days · {bucketLabel}</CardDescription>
            </div>
            <RangePicker value={range} />
          </div>
        </CardHeader>
        <div className="px-5 pb-5">
          {hasInvocations ? (
            <InvocationsChart data={invocationBuckets} />
          ) : (
            <ChartEmpty label="No invocations yet" />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle>Sync throughput</CardTitle>
              <CardDescription>Records ingested per day, by connector</CardDescription>
            </div>
            <RangePicker value={range} />
          </div>
        </CardHeader>
        <div className="px-5 pb-5">
          {hasSyncs ? (
            <SyncThroughputChart data={syncBuckets} providers={providers} />
          ) : (
            <ChartEmpty label="No sync runs in this window" />
          )}
        </div>
      </Card>
    </section>
  );
}

export function ChartsSkeleton() {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className="h-[260px] rounded-md border border-border bg-surface" />
      ))}
    </section>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="flex h-[180px] items-center justify-center rounded-sm border border-dashed border-border text-[12px] text-text-subtle">
      {label}
    </div>
  );
}

function fillInvocationBuckets(
  rows: { bucket: Date; ok: number; errors: number }[],
  since: Date,
  bucketHours: number,
): InvocationsBucket[] {
  const map = new Map<number, { ok: number; errors: number }>();
  for (const r of rows) {
    const ts = new Date(r.bucket).getTime();
    map.set(ts, { ok: r.ok ?? 0, errors: r.errors ?? 0 });
  }
  const out: InvocationsBucket[] = [];
  const start = floorTo(since.getTime(), bucketHours);
  const end = floorTo(Date.now(), bucketHours);
  const step = bucketHours * 60 * 60 * 1000;
  for (let t = start; t <= end; t += step) {
    const v = map.get(t) ?? { ok: 0, errors: 0 };
    out.push({ bucket: new Date(t).toISOString(), ok: v.ok, errors: v.errors });
  }
  return out;
}

function floorTo(ms: number, bucketHours: number): number {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  d.setUTCHours(d.getUTCHours() - (d.getUTCHours() % bucketHours));
  return d.getTime();
}

function pivotSyncRows(
  rows: { bucket: Date; provider: string; records: number }[],
  since: Date,
): { buckets: SyncBucket[]; providers: string[] } {
  const providerSet = new Set<string>();
  const map = new Map<number, Record<string, number>>();
  for (const r of rows) {
    providerSet.add(r.provider);
    const ts = new Date(r.bucket).getTime();
    const cur = map.get(ts) ?? {};
    cur[r.provider] = (cur[r.provider] ?? 0) + (r.records ?? 0);
    map.set(ts, cur);
  }
  const providers = [...providerSet].sort();
  const out: SyncBucket[] = [];
  const start = floorToDay(since.getTime());
  const end = floorToDay(Date.now());
  const step = 24 * 60 * 60 * 1000;
  for (let t = start; t <= end; t += step) {
    const row: SyncBucket = { bucket: new Date(t).toISOString() };
    for (const p of providers) {
      row[p] = map.get(t)?.[p] ?? 0;
    }
    out.push(row);
  }
  return { buckets: out, providers };
}

function floorToDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
