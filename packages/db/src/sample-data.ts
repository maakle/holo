import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DB } from './client';
import { sources, sourceArtifacts, chunks, connectorCursors } from './schema/holo';

/**
 * "sample" is a synthetic provider used to seed every fresh workspace with a
 * small Star Wars dataset so the UI is populated before any real connector
 * is wired up. It lives entirely in `sources` / `source_artifacts` /
 * `chunks` (provider = "sample") — there's no `connector_credentials` row,
 * no OAuth flow, no cursor scope, no queue. Removing the sample source
 * cascades to its artifacts and chunks via FK.
 */
export const SAMPLE_PROVIDER = 'sample';
export const SAMPLE_SOURCE_EXTERNAL_ID = 'star-wars-archive';
export const SAMPLE_SOURCE_NAME = 'Star Wars Archive';

export const SAMPLE_DATA_DESCRIPTION =
  'Curated Star Wars dataset (docs, channel messages, and issues) so you can ' +
  'see how holo organizes context before wiring up real tools.';

interface SampleArtifact {
  externalId: string;
  kind: 'doc' | 'message' | 'issue';
  title: string;
  body: string;
}

const SAMPLE_ARTIFACTS: SampleArtifact[] = [
  {
    externalId: 'doc-rebellion-charter',
    kind: 'doc',
    title: 'Rebel Alliance Founding Charter',
    body:
      'The Alliance to Restore the Republic, commonly known as the Rebel Alliance, is dedicated ' +
      'to the restoration of democratic governance across the galaxy. Founded in secret by ' +
      'Senators Mon Mothma, Bail Organa, and Garm Bel Iblis, the Alliance coordinates resistance ' +
      'cells from Yavin IV. Membership is open to any sentient species committed to opposing ' +
      'Imperial tyranny.',
  },
  {
    externalId: 'doc-death-star-plans',
    kind: 'doc',
    title: 'Death Star: Structural Analysis (DRAFT)',
    body:
      'A preliminary analysis of the DS-1 Orbital Battle Station identifies a critical ' +
      'weakness in the thermal exhaust port leading directly to the main reactor. A precise ' +
      'proton torpedo strike to the 2-meter port should trigger a chain reaction destroying ' +
      'the entire station. Targeting requires a small, agile fighter capable of trench-level ' +
      'maneuvers. Recommend further review by Red Squadron leadership.',
  },
  {
    externalId: 'doc-jedi-code',
    kind: 'doc',
    title: 'The Jedi Code',
    body:
      'There is no emotion, there is peace. There is no ignorance, there is knowledge. There ' +
      'is no passion, there is serenity. There is no chaos, there is harmony. There is no death, ' +
      'there is the Force. The Code remains the foundation of all Jedi training in the Order.',
  },
  {
    externalId: 'msg-millennium-falcon',
    kind: 'message',
    title: '#hangar-bay-12 — Han Solo',
    body:
      "Han Solo: She may not look like much, but she's got it where it counts, kid. Made " +
      'the Kessel Run in less than twelve parsecs. Chewie is prepping the hyperdrive — ' +
      'we leave for Alderaan in twenty.',
  },
  {
    externalId: 'msg-cantina-tip',
    kind: 'message',
    title: '#mos-eisley — Obi-Wan Kenobi',
    body:
      'Ben Kenobi: Mos Eisley spaceport. You will never find a more wretched hive of scum ' +
      'and villainy. We must be cautious. Looking for a pilot heading to Alderaan — discreet ' +
      'preferred. The droids must reach the Alliance.',
  },
  {
    externalId: 'msg-it-is-a-trap',
    kind: 'message',
    title: '#endor-strike-team — Admiral Ackbar',
    body:
      "Admiral Ackbar: It's a trap! The shield is still up around the moon, and the " +
      'fleet has come out of hyperdrive directly into the firing arc of an operational ' +
      'Death Star. All craft prepare to retreat.',
  },
  {
    externalId: 'issue-hoth-shield-generator',
    kind: 'issue',
    title: 'ECH-001: Echo Base shield generator vulnerable to ground assault',
    body:
      'Status: open · Priority: P0 · Assignee: General Rieekan\n' +
      'The v-150 Planet Defender shield can hold against orbital bombardment indefinitely, ' +
      'but a ground force landing outside the shield perimeter would be able to destroy ' +
      "the generator directly. AT-AT walkers are particularly threatening given the " +
      "shield's anti-personnel orientation. Mitigation: ion cannon coverage of the " +
      'evacuation corridor, plus snowspeeder harassment with tow cables.',
  },
  {
    externalId: 'issue-bespin-betrayal',
    kind: 'issue',
    title: 'BSP-014: Bespin facility compromised — Imperial garrison on-site',
    body:
      'Status: critical · Priority: P0 · Reporter: L. Calrissian\n' +
      'Lord Vader arrived ahead of the rebel party and forced an arrangement under ' +
      'duress. Cloud City security has been disarmed. Recommend immediate evacuation ' +
      'of all Bespin personnel via the eastern landing platform. The arrangement is ' +
      'getting worse all the time.',
  },
  {
    externalId: 'issue-carbonite-thaw',
    kind: 'issue',
    title: 'JAB-009: Recover Captain Solo from Jabba the Hutt',
    body:
      'Status: in progress · Priority: P1 · Owner: Princess Leia Organa\n' +
      "Subject was frozen in carbonite at Cloud City and delivered to Jabba's palace on " +
      'Tatooine as a wall trophy. Hibernation sickness expected on revival (temporary ' +
      'blindness, motor impairment). Plan: infiltrate as bounty hunter Boushh, ' +
      'fallback rescue at the Sarlacc pit. Skiff guards must be neutralized.',
  },
];

function contentHash(orgId: string, externalId: string, content: string): string {
  return createHash('sha256')
    .update(orgId)
    .update('|')
    .update(externalId)
    .update('|')
    .update(content)
    .digest('hex');
}

/**
 * Idempotently install Star Wars sample data for an org. Safe to call
 * repeatedly — re-running is a no-op once the source row exists.
 */
export async function ensureSampleData(
  db: DB,
  organizationId: string,
): Promise<{ created: boolean; artifactCount: number }> {
  const existing = await db
    .select({ id: sources.id })
    .from(sources)
    .where(
      and(
        eq(sources.organizationId, organizationId),
        eq(sources.provider, SAMPLE_PROVIDER),
        eq(sources.externalId, SAMPLE_SOURCE_EXTERNAL_ID),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return { created: false, artifactCount: SAMPLE_ARTIFACTS.length };
  }

  const insertedSource = await db
    .insert(sources)
    .values({
      organizationId,
      provider: SAMPLE_PROVIDER,
      externalId: SAMPLE_SOURCE_EXTERNAL_ID,
      name: SAMPLE_SOURCE_NAME,
      metadata: { sample: true, theme: 'star-wars' },
    })
    .returning({ id: sources.id });
  const sourceId = insertedSource[0]!.id;

  for (const a of SAMPLE_ARTIFACTS) {
    const artifact = await db
      .insert(sourceArtifacts)
      .values({
        organizationId,
        sourceId,
        externalId: a.externalId,
        kind: a.kind,
        payload: { title: a.title, body: a.body },
      })
      .returning({ id: sourceArtifacts.id });
    const artifactId = artifact[0]!.id;

    const content = `${a.title}\n\n${a.body}`;
    await db.insert(chunks).values({
      organizationId,
      sourceArtifactId: artifactId,
      sourceId,
      provider: SAMPLE_PROVIDER,
      kind: a.kind,
      content,
      contentHash: contentHash(organizationId, a.externalId, content),
      metadata: { sample: true, title: a.title },
    });
  }

  // Mark the run as ok so the connections page shows a green "synced" state
  // immediately rather than "Never synced".
  await db.insert(connectorCursors).values({
    organizationId,
    sourceId,
    scope: 'sample',
    lastRunAt: new Date(),
    lastStatus: 'ok',
  });

  return { created: true, artifactCount: SAMPLE_ARTIFACTS.length };
}

export interface SampleDataStatus {
  active: boolean;
  artifactCount: number;
  installedAt: string | null;
}

export async function getSampleDataStatus(
  db: DB,
  organizationId: string,
): Promise<SampleDataStatus> {
  const rows = await db
    .select({
      id: sources.id,
      createdAt: sources.createdAt,
      count: sql<number>`count(${sourceArtifacts.id})::int`,
    })
    .from(sources)
    .leftJoin(sourceArtifacts, eq(sourceArtifacts.sourceId, sources.id))
    .where(
      and(
        eq(sources.organizationId, organizationId),
        eq(sources.provider, SAMPLE_PROVIDER),
        eq(sources.externalId, SAMPLE_SOURCE_EXTERNAL_ID),
      ),
    )
    .groupBy(sources.id, sources.createdAt)
    .limit(1);

  const row = rows[0];
  if (!row) return { active: false, artifactCount: 0, installedAt: null };
  return {
    active: true,
    artifactCount: row.count ?? 0,
    installedAt: row.createdAt.toISOString(),
  };
}

export async function removeSampleData(
  db: DB,
  organizationId: string,
): Promise<{ removed: boolean }> {
  const result = await db
    .delete(sources)
    .where(
      and(
        eq(sources.organizationId, organizationId),
        eq(sources.provider, SAMPLE_PROVIDER),
        eq(sources.externalId, SAMPLE_SOURCE_EXTERNAL_ID),
      ),
    )
    .returning({ id: sources.id });
  return { removed: result.length > 0 };
}
