/**
 * Microsoft Teams resolver for `user_subjects_cache`.
 *
 * Walks the resources the @holo bot is installed in (teams + chats) and
 * checks whether the given AAD object id appears in each resource's
 * membership roster. Produces the subject set the chunker's ACL relies
 * on:
 *
 *   - `team:<aadTeamId>` for every team the user is in (where bot is
 *     also a member — RSC enforces visibility)
 *   - `chat:<chatId>` for every chat the user is in (same RSC scope)
 *
 * Defining the interface locally rather than importing
 * `TeamsGraphClient` from `@holo/connectors` keeps this package free
 * of a hard dep — the actual client from PR #202 structurally
 * satisfies this shape.
 *
 * What's not in this resolver:
 *
 *   - **Private-channel subjects** (`team-channel:<channelId>`).
 *     Requires `listChannelMembers` which the current Graph client
 *     doesn't expose. The chunker emits `team-channel:<id>` for
 *     private-channel content already; until this resolver returns
 *     matching subjects, private-channel threads stay invisible to
 *     retrieval — which is the safer failure mode. Tracked as
 *     follow-up after Step 7.
 *   - **Caching.** The resolver re-fetches membership on every run.
 *     The Teams sync runner already calls `loadResourceMembers` for
 *     each resource; a future optimization can reuse those rosters
 *     from `sources.metadata.member_aad_ids` instead of round-tripping
 *     Graph here.
 */

export interface TeamsSubjectsGraphClient {
  /** Teams the bot is installed in. */
  listJoinedTeams(): Promise<Array<{ id: string }>>;
  /** Roster for a team — returns AAD object ids of every member. */
  listTeamMembers(teamId: string): Promise<Array<{ userId?: string }>>;
  /** Chats the bot is installed in. */
  listChats(): Promise<{ value: Array<{ id: string }> }>;
  /** Roster for a chat — returns AAD object ids of every member. */
  listChatMembers(chatId: string): Promise<Array<{ userId?: string }>>;
}

export async function resolveTeamsSubjects(args: {
  graph: TeamsSubjectsGraphClient;
  /** AAD object id of the holo user — must match `userId` on a member row. */
  aadObjectId: string;
}): Promise<string[]> {
  const subjects = new Set<string>();

  // Teams. For each team the bot is installed in (RSC restricts the
  // listing to those), check membership.
  const teams = await args.graph.listJoinedTeams();
  for (const team of teams) {
    let members: Array<{ userId?: string }>;
    try {
      members = await args.graph.listTeamMembers(team.id);
    } catch {
      // 403 here means the bot was removed mid-resolve — skip this team
      // but continue. Don't let one resource's failure abort the rest.
      continue;
    }
    if (members.some((m) => m.userId === args.aadObjectId)) {
      subjects.add(`team:${team.id}`);
    }
  }

  // Chats. Same shape — listChats returns chats the bot is in (RSC).
  let page: { value: Array<{ id: string }>; '@odata.nextLink'?: string };
  try {
    page = (await args.graph.listChats()) as typeof page;
  } catch {
    // Resolve-time fetch errors are non-fatal — emit what we have for
    // teams and let the next sync retry chats.
    return [...subjects].sort();
  }
  for (const chat of page.value) {
    let members: Array<{ userId?: string }>;
    try {
      members = await args.graph.listChatMembers(chat.id);
    } catch {
      continue;
    }
    if (members.some((m) => m.userId === args.aadObjectId)) {
      subjects.add(`chat:${chat.id}`);
    }
  }

  return [...subjects].sort();
}
