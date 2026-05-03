'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { randomBytes, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import { getServerContext } from '@/lib/server-context';

export interface CreateTokenResult {
  ok: boolean;
  error?: string;
  // Plaintext is returned ONLY on successful creation so the user can copy it.
  // Not persisted anywhere — only the SHA-256 hash lives in the DB.
  plaintext?: string;
  name?: string;
  prefix?: string;
}

const TOKEN_PREFIX = 'holo_';

async function requireSession() {
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    throw holoError({
      code: ErrorCode.HOLO_AUTH_NO_SESSION,
      problem: 'no active session',
      fix: 'Sign in and try again.',
    });
  }
  const user = session.user as unknown as { id: string; organizationId: string };
  return { db, user };
}

export async function createToken(
  _prev: CreateTokenResult | null,
  formData: FormData,
): Promise<CreateTokenResult> {
  const name = String(formData.get('name') ?? '').trim();
  if (!name) {
    return { ok: false, error: 'Token name is required.' };
  }
  if (name.length > 64) {
    return { ok: false, error: 'Token name must be 64 characters or fewer.' };
  }

  const { db, user } = await requireSession();

  const random = randomBytes(24).toString('base64url');
  const plaintext = `${TOKEN_PREFIX}${random}`;
  const prefix = random.slice(0, 8);
  const hashedToken = createHash('sha256').update(plaintext).digest('hex');

  await db.insert(schema.apiToken).values({
    organizationId: user.organizationId,
    userId: user.id,
    name,
    prefix,
    hashedToken,
  });

  revalidatePath('/dashboard/connect-agent');
  return { ok: true, plaintext, name, prefix };
}

export async function revokeToken(formData: FormData): Promise<void> {
  const tokenId = String(formData.get('tokenId') ?? '');
  if (!tokenId) return;
  const { db, user } = await requireSession();

  await db
    .update(schema.apiToken)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.apiToken.id, tokenId),
        eq(schema.apiToken.organizationId, user.organizationId),
        eq(schema.apiToken.userId, user.id),
      ),
    );
  revalidatePath('/dashboard/connect-agent');
}
