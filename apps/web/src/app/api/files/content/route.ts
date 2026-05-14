/**
 * GET /api/files/content?path=/slack/...
 *
 * Returns the rendered markdown content of a file at `path`. Per-user ACL
 * enforced via HoloFs — same enforcement boundary as the agent path.
 *
 * RFC 0009 Phase 5.
 */
import { HoloFs } from '@holo/holofs';
import { getSubjectsForUser } from '@holo/user-subjects';
import { holoError, ErrorCode } from '@holo/errors';
import { withActiveOrg } from '@/lib/with-active-org';

export const dynamic = 'force-dynamic';

export const GET = withActiveOrg(async ({ req, ctx, session, orgId }) => {
  const path = req.nextUrl.searchParams.get('path');
  if (!path) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'path query parameter is required',
      fix: 'GET /api/files/content?path=/slack/...',
    });
  }

  const userId = session.user.id;
  const extraSubjects = await getSubjectsForUser(ctx.db, userId);
  const userSubjects = [`org:${orgId}`, `user:${userId}`, ...extraSubjects];

  const fs = new HoloFs({ db: ctx.db, organizationId: orgId, userSubjects });

  try {
    const [stat, content] = await Promise.all([fs.stat(path), fs.readFile(path)]);
    return {
      path: stat.path,
      kind: stat.kind ?? null,
      content,
      artifactId: stat.artifactId ?? null,
      updatedAt: stat.updatedAt?.toISOString() ?? null,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ENOENT') {
      throw holoError({
        code: ErrorCode.HOLO_NOT_FOUND,
        problem: `No file at ${path}`,
        fix: 'Verify the path; the file may have been deleted or you may not have access.',
      });
    }
    if (code === 'EINVAL') {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: (err as Error).message,
        fix: 'Use an absolute POSIX path (starts with /, no .. segments).',
      });
    }
    throw err;
  }
});
