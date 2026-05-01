import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { autoExtractSkills } from '@holo/skills';
import { parseEnv } from '@holo/env';

export async function POST(): Promise<Response> {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect('/sign-in') as never;

  const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
  if (!orgId) return redirect('/sign-in') as never;

  const env = parseEnv(process.env);
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 400 });
  }

  const invocations = await db
    .select({
      toolName: schema.mcpInvocations.toolName,
      inputJson: schema.mcpInvocations.inputJson,
    })
    .from(schema.mcpInvocations)
    .where(eq(schema.mcpInvocations.organizationId, orgId))
    .orderBy(desc(schema.mcpInvocations.createdAt))
    .limit(200);

  const proposals = await autoExtractSkills({
    invocations: invocations.map((i) => ({
      toolName: i.toolName,
      inputJson: (i.inputJson as Record<string, unknown>) ?? {},
    })),
    apiKey: env.ANTHROPIC_API_KEY,
    maxProposals: 3,
  });

  return NextResponse.json({ proposals });
}
