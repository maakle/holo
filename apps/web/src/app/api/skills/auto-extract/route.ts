import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { desc, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/server-context';
import { schema } from '@holo/db';
import { autoExtractSkills } from '@holo/skills';
import { parseEnv } from '@holo/env';
import { holoError, ErrorCode, HoloError } from '@holo/errors';

export async function POST(): Promise<Response> {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in.',
      });

    const orgId = (session.user as unknown as { organizationId?: string }).organizationId;
    if (!orgId)
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'no organization associated with session',
        fix: 'Sign in.',
      });

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

    if (invocations.length === 0) {
      return NextResponse.json({ error: 'no_usage_data', message: 'No invocation history found. Use the MCP tools first to generate usage data.' }, { status: 400 });
    }

    const proposals = await autoExtractSkills({
      invocations: invocations.map((i) => ({
        toolName: i.toolName,
        inputJson: (i.inputJson as Record<string, unknown>) ?? {},
      })),
      apiKey: env.ANTHROPIC_API_KEY,
      maxProposals: 3,
    });

    return NextResponse.json({ proposals });
  } catch (e) {
    if (e instanceof HoloError)
      return NextResponse.json(e.toJSON(), {
        status: e.code === 'HOLO_AUTH_NO_SESSION' ? 401 : 400,
      });
    return NextResponse.json({ code: 'HOLO_INTERNAL', problem: 'unexpected error' }, { status: 500 });
  }
}
