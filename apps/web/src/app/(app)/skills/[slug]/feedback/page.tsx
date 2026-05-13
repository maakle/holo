// Feedback inbox (RFC-0008).
//
// Lists recent feedback rows for the given skill (newest first). Each row
// shows the question, the agent's answer, optional correction, and a
// "Promote to eval" button that opens an inline structured `expected`
// editor (substrings / must_cite / must_not_say). Per RFC, owner/admin
// permissions are enforced server-side in the promote endpoint; the UI
// surfaces the button to everyone and the server gates the write.

import { headers } from 'next/headers';
import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@holo/db';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { FeedbackList } from './feedback-list';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function FeedbackInboxPage({ params }: PageProps) {
  const { slug } = await params;
  const { auth, db } = await getServerContext();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return <p className="text-text-muted">Sign in to view feedback.</p>;
  }
  const orgId = resolveActiveOrgId(session);

  const rows = await db
    .select({
      id: schema.answerFeedback.id,
      answerId: schema.answerFeedback.answerId,
      rating: schema.answerFeedback.rating,
      correctionText: schema.answerFeedback.correctionText,
      question: schema.answerFeedback.question,
      answer: schema.answerFeedback.answer,
      createdAt: schema.answerFeedback.createdAt,
    })
    .from(schema.answerFeedback)
    .where(
      and(
        eq(schema.answerFeedback.organizationId, orgId),
        eq(schema.answerFeedback.skillSlug, slug),
      ),
    )
    .orderBy(desc(schema.answerFeedback.createdAt))
    .limit(100);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={`/skills/${slug}`}
          className="caption text-text-subtle hover:text-text"
        >
          ← {slug}
        </Link>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Feedback inbox
        </h1>
        <p className="max-w-2xl text-[13px] leading-6 text-text-muted">
          Recent 👍 / 👎 / corrections on assistant turns scoped to{' '}
          <code className="font-mono text-[12px]">{slug}</code>. Promote a row
          into an eval entry to lock the behavior in against future regressions.
        </p>
      </div>
      <FeedbackList
        slug={slug}
        rows={rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
