import type { DB } from '@holo/db';
import { emitAuditEvent } from '@holo/audit';
import { replaceSubjectsForUser } from './repository';
import { resolveSlackSubjects, type SlackChannelLister } from './slack-resolver';
import {
  resolveTeamsSubjects,
  type TeamsSubjectsGraphClient,
} from './teams-resolver';

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

export interface RunTeamsSyncInput {
  db: DB;
  userId: string;
  organizationId: string;
  /**
   * AAD object id of the holo user. Sourced from `better_auth.account`
   * for users who signed in via Azure AD, or from the bot's
   * `from.aadObjectId` when the user has @mentioned the bot at least
   * once. The trigger that calls this function (lands in step 7) owns
   * the lookup.
   */
  aadObjectId: string;
  graph: TeamsSubjectsGraphClient;
}

/**
 * Walks every team + chat the bot is installed in, captures the ones
 * the given AAD user is a member of, and replaces the `'teams'`-source
 * rows in `user_subjects_cache`. Cost: one Graph call per resource
 * (typically tens, not thousands).
 *
 * The chunker emits `team:<id>` / `chat:<id>` / `team-channel:<id>`
 * ACL subjects from PR #203. Until matching subjects appear in the
 * cache, retrieval falls back to the universal `org:<id>` subject —
 * Teams content technically retrievable by every org member. This
 * function closes that gap.
 */
export async function runTeamsSubjectsSync(
  input: RunTeamsSyncInput,
): Promise<{ count: number }> {
  const subjects = await resolveTeamsSubjects({
    graph: input.graph,
    aadObjectId: input.aadObjectId,
  });
  await replaceSubjectsForUser(input.db, {
    userId: input.userId,
    organizationId: input.organizationId,
    source: 'teams',
    subjects,
  });
  emitAuditEvent({
    db: input.db,
    organizationId: input.organizationId,
    userId: input.userId,
    eventType: 'user_subjects.refreshed',
    resourceType: 'user_subjects_cache',
    resourceId: input.userId,
    meta: { source: 'teams', count: subjects.length },
  });
  return { count: subjects.length };
}
