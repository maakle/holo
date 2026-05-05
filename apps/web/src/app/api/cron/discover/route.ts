import { NextResponse } from 'next/server';
import { schema } from '@holo/db';
import { runDiscovery } from '@holo/discovery';
import { getServerContext } from '@/lib/server-context';
import { buildDiscoveryDb } from '@/lib/discovery-db';

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });
  }

  const { db } = await getServerContext();
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);

  const adapter = buildDiscoveryDb(db);
  const results: Record<string, unknown> = {};
  for (const o of orgs) {
    try {
      results[o.id] = await runDiscovery({ orgId: o.id, apiKey, db: adapter });
    } catch (err) {
      results[o.id] = { error: String(err) };
    }
  }
  return NextResponse.json(results);
}
