import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { runDiscovery } from '@holo/discovery';
import { getServerContext } from '@/lib/server-context';
import { buildDiscoveryDb } from '@/lib/discovery-db';

export async function POST() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const orgId = (session.user as unknown as { organizationId: string }).organizationId;

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return NextResponse.json({ error: 'missing_api_key' }, { status: 500 });

  const result = await runDiscovery({
    orgId,
    apiKey,
    db: buildDiscoveryDb(db),
  });
  return NextResponse.json(result);
}
