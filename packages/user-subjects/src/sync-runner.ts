import type { DB } from '@holo/db';
import { emitAuditEvent } from '@holo/audit';
import { replaceSubjectsForUser } from './repository';
import { resolveSlackSubjects, type SlackChannelLister } from './slack-resolver';

export interface RunSlackSyncInput {
  db: DB;
  userId: string;
  organizationId: string;
  client: SlackChannelLister;
}

export async function runSlackSubjectsSync(
  input: RunSlackSyncInput,
): Promise<{ count: number }> {
  const subjects = await resolveSlackSubjects(input.client);
  await replaceSubjectsForUser(input.db, {
    userId: input.userId,
    organizationId: input.organizationId,
    source: 'slack',
    subjects,
  });
  emitAuditEvent({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: 'user_subjects.refreshed',
    resourceType: 'user_subjects_cache',
    resourceId: input.userId,
    meta: { source: 'slack', count: subjects.length },
  });
  return { count: subjects.length };
}
