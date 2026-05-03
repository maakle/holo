import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getServerContext } from '@/lib/server-context';

export async function RecentInvocations({ orgId }: { orgId: string }) {
  const { db } = await getServerContext();
  const rows = await db
    .select({
      id: schema.mcpInvocations.id,
      toolName: schema.mcpInvocations.toolName,
      latencyMs: schema.mcpInvocations.latencyMs,
      errorCode: schema.mcpInvocations.errorCode,
      createdAt: schema.mcpInvocations.createdAt,
    })
    .from(schema.mcpInvocations)
    .where(eq(schema.mcpInvocations.organizationId, orgId))
    .orderBy(desc(schema.mcpInvocations.createdAt))
    .limit(5);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex flex-col gap-1">
          <CardTitle>Recent invocations</CardTitle>
          <CardDescription>Last 5 MCP tool calls from your agents.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/observability">View all →</Link>
        </Button>
      </CardHeader>
      <CardContent className="px-0">
        {rows.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] text-text-muted">
              No invocations yet. Connect an agent to see live activity.
            </p>
            <Button variant="primary" size="sm" className="mt-4" asChild>
              <Link href="/connect-agent">Connect agent</Link>
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-4 px-5 py-3 text-[13px] hover:bg-surface-2"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Badge variant={inv.errorCode ? 'error' : 'success'}>
                    {inv.errorCode ? 'error' : 'ok'}
                  </Badge>
                  <span className="font-mono truncate text-text">{inv.toolName}</span>
                </div>
                <div className="flex shrink-0 items-center gap-4 text-text-muted">
                  <span className="font-mono tabular-nums">{inv.latencyMs}ms</span>
                  <time className="font-mono text-text-subtle">
                    {inv.createdAt.toISOString().slice(11, 19)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function RecentInvocationsSkeleton() {
  return <div className="h-72 rounded-md border border-border bg-surface lg:col-span-2" />;
}
