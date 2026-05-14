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
  // ─── Pan-saga ───────────────────────────────────────────────────────────────
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
    externalId: 'doc-jedi-code',
    kind: 'doc',
    title: 'The Jedi Code',
    body:
      'There is no emotion, there is peace. There is no ignorance, there is knowledge. There ' +
      'is no passion, there is serenity. There is no chaos, there is harmony. There is no death, ' +
      'there is the Force. The Code remains the foundation of all Jedi training in the Order.',
  },
  {
    externalId: 'doc-skywalker-saga-overview',
    kind: 'doc',
    title: 'Skywalker Saga: A Galactic Historian\'s Summary',
    body:
      'Three generations, one bloodline, one recurring fall and redemption. Episodes I–III ' +
      'chart the slide of the Galactic Republic into Empire under Chancellor (later Emperor) ' +
      'Palpatine, and the corruption of Anakin Skywalker into Darth Vader. Episodes IV–VI ' +
      'follow his son Luke and a small Rebel Alliance as they topple the Empire and redeem ' +
      'Vader at the second Death Star. Episodes VII–IX trace the rise of the First Order ' +
      'from Imperial remnants, the discovery of Rey, and the final defeat of a resurrected ' +
      'Palpatine at Exegol. The throughline is family, mentorship, and the cyclical pull ' +
      'between the light and dark sides of the Force.',
  },

  // ─── Episode I — The Phantom Menace ────────────────────────────────────────
  {
    externalId: 'doc-trade-federation-blockade',
    kind: 'doc',
    title: 'TF-Blockade Briefing: Naboo (Senate Eyes Only)',
    body:
      'The Trade Federation, under Viceroy Nute Gunray, has surrounded the planet Naboo with ' +
      'Lucrehulk-class battleships in protest of new Republic taxation of outlying trade routes. ' +
      'Chancellor Valorum has dispatched Jedi Masters Qui-Gon Jinn and Obi-Wan Kenobi as ' +
      'ambassadors. Intelligence suggests the blockade is a pretext for ground invasion using ' +
      'battle droid divisions. Queen Padmé Amidala is being advised to seek emergency aid from ' +
      'the Galactic Senate on Coruscant. Risk assessment: Federation actions appear coordinated ' +
      'with an unknown Sith influence.',
  },
  {
    externalId: 'msg-qui-gon-tatooine',
    kind: 'message',
    title: '#jedi-council-relay — Qui-Gon Jinn (Tatooine)',
    body:
      'Qui-Gon Jinn: Stranded on Tatooine. Hyperdrive generator damaged escaping the blockade. ' +
      'I have encountered a boy — Anakin Skywalker, age nine, no father. Midi-chlorian count ' +
      'over twenty thousand. Higher than Master Yoda. I believe he is the prophesied one who ' +
      'will bring balance to the Force. Requesting permission to begin his training. He freed ' +
      'us by winning the Boonta Eve podrace.',
  },
  {
    externalId: 'issue-naboo-invasion',
    kind: 'issue',
    title: 'NAB-001: Reclaim Theed Palace from droid occupation',
    body:
      'Status: open · Priority: P0 · Owner: Queen Padmé Amidala\n' +
      'The Federation has occupied Theed and rounded up the Naboo into camps. Plan of attack: ' +
      '(1) Gungan Grand Army draws droid forces to the plains as a diversion; (2) Naboo pilots ' +
      'launch from Theed hangars to disable the Federation control ship in orbit — disabling it ' +
      'should shut down the entire droid army; (3) palace strike team capturing Viceroy Gunray ' +
      'to force a surrender. Risk: a robed Zabrak assassin with a double-bladed lightsaber was ' +
      'sighted on Tatooine and may intercept the Jedi escort.',
  },

  // ─── Episode II — Attack of the Clones ─────────────────────────────────────
  {
    externalId: 'doc-kamino-clone-manifest',
    kind: 'doc',
    title: 'Kamino Cloning Facility: Phase I Manifest',
    body:
      'Per order of the late Master Sifo-Dyas (records disputed), the Kaminoans have produced ' +
      'an army of two hundred thousand units, with another million well on the way. Genetic ' +
      'template: bounty hunter Jango Fett, modified for growth acceleration and obedience. ' +
      'The Grand Army of the Republic is intended for deployment if the Separatist Crisis ' +
      'escalates into open war. Behavioural inhibitor chips are installed in every clone; ' +
      'function classified to Chancellor Palpatine\'s office only.',
  },
  {
    externalId: 'msg-obiwan-geonosis',
    kind: 'message',
    title: '#jedi-council-relay — Obi-Wan Kenobi (Geonosis)',
    body:
      'Obi-Wan Kenobi: Tracked the assassin\'s bounty hunter to Geonosis. Confirmed: Count Dooku ' +
      'is leading a Confederacy of Independent Systems — Trade Federation, Techno Union, ' +
      'Banking Clan, Commerce Guild, all signing a treaty for war. Massive droid foundries in ' +
      'operation. Transmission may be intercepted — I have been captured. Anakin, do not come ' +
      'after me. Tell the Council. (Transmission ends.)',
  },
  {
    externalId: 'issue-padme-assassination',
    kind: 'issue',
    title: 'CSC-002: Repeated assassination attempts on Senator Amidala',
    body:
      'Status: open · Priority: P0 · Assignee: Jedi Council\n' +
      'Two attempts in 48 hours: a freighter explosion on the Coruscant landing pad, then ' +
      'kouhuns released into the Senator\'s sleeping quarters via a probe droid. Bounty hunter ' +
      'Zam Wesell killed before interrogation by a toxic dart of unknown origin (Kamino-issue). ' +
      'Protective detail assigned: Padawan Anakin Skywalker escorting the Senator to Naboo ' +
      'under cover. Investigator: Obi-Wan Kenobi tracing the dart upstream.',
  },

  // ─── Episode III — Revenge of the Sith ─────────────────────────────────────
  {
    externalId: 'doc-order-66-contingency',
    kind: 'doc',
    title: 'GAR Contingency Order 66 (CLASSIFIED — Supreme Commander Eyes Only)',
    body:
      'In the event Jedi officers act against the interests of the Republic, GAR commanders ' +
      'shall, on receipt of verified orders from the Supreme Commander (Chancellor), remove ' +
      'said officers by lethal force. Compliance is enforced via the biochip implants installed ' +
      'in every clone trooper on Kamino — activated by the verbal command "Execute Order 66," ' +
      'the chips override loyalty to the Jedi generals and reframe them as traitors to the ' +
      'Republic. This contingency is authorized by the Office of the Supreme Chancellor. The ' +
      'Jedi Council is not to be informed of this order under any circumstances.',
  },
  {
    externalId: 'msg-organa-yoda',
    kind: 'message',
    title: '#secure-channel-alpha — Bail Organa to Master Yoda',
    body:
      'Bail Organa: It is done. Senator Amidala did not survive childbirth on Polis Massa. ' +
      'Twins. The girl I will take to Alderaan; my wife and I have wanted a child for so long. ' +
      'The boy goes to Tatooine — Owen and Beru Lars, his step-family. Obi-Wan will watch over ' +
      'him from the Jundland Wastes. Hide them, separate them. Their father must never learn ' +
      'they live. May the Force be with us all.',
  },
  {
    externalId: 'issue-temple-breach',
    kind: 'issue',
    title: 'JT-666: Jedi Temple breach — Coruscant',
    body:
      'Status: catastrophic · Priority: P0 · Reporter: Master Yoda\n' +
      'The 501st Legion under Lord Vader (formerly Knight Skywalker) has entered the Temple ' +
      'and is executing all Jedi on sight, including younglings in the Council chamber. The ' +
      'beacon has been altered to call surviving Jedi home into the trap. Master Kenobi and I ' +
      'must enter, reset the beacon to a warning, and review the security recordings to confirm ' +
      'the identity of the Sith Lord. The Republic, as we knew it, has fallen.',
  },

  // ─── Episode IV — A New Hope ───────────────────────────────────────────────
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
    externalId: 'msg-cantina-tip',
    kind: 'message',
    title: '#mos-eisley — Obi-Wan Kenobi',
    body:
      'Ben Kenobi: Mos Eisley spaceport. You will never find a more wretched hive of scum ' +
      'and villainy. We must be cautious. Looking for a pilot heading to Alderaan — discreet ' +
      'preferred. The droids must reach the Alliance.',
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

  // ─── Episode V — The Empire Strikes Back ───────────────────────────────────
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
    externalId: 'msg-dagobah-training',
    kind: 'message',
    title: '#dagobah-private — Master Yoda',
    body:
      'Yoda: Reckless he is. Much anger in him, like his father. The boy lifted rocks, yes — ' +
      'but the X-wing, doubted he could. "Try not. Do, or do not. There is no try." Visions of ' +
      'a city in the clouds he has. To leave training, he wishes. If go he does, complete his ' +
      'training he will not, and lose everything we may. The dark side clouds my sight.',
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

  // ─── Episode VI — Return of the Jedi ───────────────────────────────────────
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
  {
    externalId: 'doc-endor-shield-bunker',
    kind: 'doc',
    title: 'Endor Forest Moon: Shield Bunker Reconnaissance',
    body:
      'The deflector shield protecting the second Death Star is generated from a bunker on the ' +
      'forest moon of Endor. The bunker is staffed by a token Imperial detachment relative to ' +
      'the strategic value; the Emperor evidently considers the location secret. Approach via ' +
      'stolen Imperial shuttle Tydirium using a captured clearance code. Local sentient species ' +
      '(Ewoks) are tribal but may be persuadable allies. Strike team led by General Solo; ' +
      'rendezvous with Admiral Ackbar\'s fleet at the agreed jump coordinates.',
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

  // ─── Episode VII — The Force Awakens ───────────────────────────────────────
  {
    externalId: 'doc-starkiller-recon',
    kind: 'doc',
    title: 'Resistance Recon: Starkiller Base',
    body:
      'The First Order has hollowed out an ice planet in the Unknown Regions and converted it ' +
      'into a superweapon larger than any Death Star precedent. The base drains the energy of ' +
      'a nearby star to fire a hyperspace-traversing beam capable of destroying entire star ' +
      'systems simultaneously — confirmed by the destruction of the Hosnian system and the New ' +
      'Republic Senate. Vulnerability: the thermal oscillator. Destroying the oscillator ' +
      'releases the accumulated stellar energy back into the planetary core, collapsing the ' +
      'base from within. Strike window opens during recharge before the next firing — engage ' +
      'before the star is fully drained.',
  },
  {
    externalId: 'msg-poe-finn-map',
    kind: 'message',
    title: '#resistance-ops — Poe Dameron',
    body:
      'Poe Dameron: Finn, listen — I hid the map fragment in BB-8 before they took me. He is ' +
      'somewhere on Jakku. Find him, get him to General Organa, and the Resistance has a chance ' +
      'of finding Luke Skywalker. We need the last Jedi. If you make it out and I do not — ' +
      'thanks for the rescue, buddy. May the Force be with you.',
  },
  {
    externalId: 'issue-bb8-recovery',
    kind: 'issue',
    title: 'JAK-117: Recover astromech BB-8 and map fragment from Jakku',
    body:
      'Status: open · Priority: P0 · Reporter: General Leia Organa\n' +
      'Astromech droid BB-8 is carrying a partial map to the location of Luke Skywalker. Last ' +
      'known location: Niima Outpost area, Jakku. Local scavenger (designation: "Rey") and a ' +
      'defected First Order stormtrooper (FN-2187, "Finn") are currently in possession of the ' +
      'droid. First Order TIE squadrons in pursuit. Authorize Han Solo and Chewbacca to ' +
      'intercept and extract via the Millennium Falcon if recovered.',
  },

  // ─── Episode VIII — The Last Jedi ──────────────────────────────────────────
  {
    externalId: 'doc-ahch-to-texts',
    kind: 'doc',
    title: 'Ahch-To Inventory: The Sacred Jedi Texts',
    body:
      'Eight volumes recovered from the first Jedi Temple on Ahch-To, the oldest known Jedi ' +
      'tree-library. The texts predate the founding of the Order and contain teachings on ' +
      'the Force unfiltered by Jedi orthodoxy. Master Skywalker considered burning them; ' +
      'their current whereabouts are with R. (Rey) per his unspoken consent. Note that the ' +
      'Force is not the property of the Jedi. To say that if the Jedi die the light dies is ' +
      'pure vanity.',
  },
  {
    externalId: 'msg-holdo-transfer',
    kind: 'message',
    title: '#raddus-bridge — Vice Admiral Holdo',
    body:
      'Vice Admiral Amilyn Holdo: With General Organa incapacitated, command of the fleet ' +
      'falls to me. We will not be drawing the First Order into open battle — we cannot win. ' +
      'Instead, a covert evacuation to the abandoned Rebel outpost on Crait via unmarked ' +
      'transports. Captain Dameron is not to be informed; his temperament cannot be trusted ' +
      'with the operation. I will pilot the Raddus on a hyperspace ramming intercept as cover. ' +
      'Godspeed, Resistance.',
  },
  {
    externalId: 'issue-crait-siege',
    kind: 'issue',
    title: 'CRT-022: First Order superlaser siege cannon at Crait outpost',
    body:
      'Status: critical · Priority: P0 · Owner: Poe Dameron\n' +
      'First Order ground force has deployed a superlaser siege cannon — miniaturized ' +
      'Death Star technology powered by a kyber crystal, also known as the battering ram ' +
      'cannon — towed across the salt plains by AT-HH heavy haulers to breach the blast doors ' +
      'of the abandoned Crait outpost. Resistance numbers under 20 survivors. Mitigation: ' +
      'ski speeders against the AT-M6 walker line and TIE escort (high casualties expected). ' +
      'Diversion required for evacuation through the back tunnels — Master Skywalker ' +
      'projecting from Ahch-To to engage Kylo Ren personally. Find us hope, anywhere.',
  },

  // ─── Episode IX — The Rise of Skywalker ────────────────────────────────────
  {
    externalId: 'doc-exegol-fleet',
    kind: 'doc',
    title: 'Sith Eternal Final Order: Exegol Shipyards',
    body:
      'Hidden in the Unknown Regions on the Sith world of Exegol, the Sith Eternal cultists ' +
      'have constructed a fleet of Xyston-class Star Destroyers — over a thousand hulls — each ' +
      'equipped with axial superlaser cannons capable of planet destruction. The fleet is ' +
      'commanded by the resurrected Emperor Palpatine, who has survived in a cloned, decaying ' +
      'body sustained by Sith alchemy. The fleet cannot launch without a planetary navigation ' +
      'signal from a Sith wayfinder; disabling the navigation tower on the command ship ' +
      '(Steadfast) grounds the entire armada.',
  },
  {
    externalId: 'msg-lando-rally',
    kind: 'message',
    title: '#open-channel — General Lando Calrissian',
    body:
      'Lando Calrissian: This is General Calrissian to anyone listening. The Resistance stands ' +
      'alone at Exegol against a thousand Star Destroyers. If you have a ship and a heart, jump ' +
      'now — Mid Rim, Outer Rim, doesn\'t matter. Spice runners of Kijimi, freighter captains, ' +
      'old friends, settle accounts later. They win by making us think we\'re alone. We are not ' +
      'alone. The Force will be with us.',
  },
  {
    externalId: 'issue-wayfinder-retrieval',
    kind: 'issue',
    title: 'PAS-013: Retrieve Sith wayfinder — Pasaana → Kijimi → Kef Bir',
    body:
      'Status: in progress · Priority: P0 · Owner: Rey\n' +
      'Two Sith wayfinders are known to exist; one is on Vader\'s pyre on Mustafar (destroyed), ' +
      'the other on a Death Star wreckage at Kef Bir. Trail: (1) Pasaana — recover the dagger ' +
      'inscribed with Sith location runes from the festival of the ancestors; (2) Kijimi — ' +
      'have droidsmith Babu Frik translate (C-3PO\'s forbidden Sith subroutines must be ' +
      'unlocked, wiping his memory); (3) Kef Bir — descend into the throne room of the second ' +
      'Death Star. Confrontation with Kylo Ren expected at the wreckage.',
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
    // Backfill ACL on chunks installed before aclSubjects was set here. Empty
    // acl_subjects fails the array-overlap filter in retrieval-core/search,
    // making the sample invisible to the agent.
    await db.execute(sql`
      UPDATE chunks
      SET acl_subjects = ARRAY[${'org:' + organizationId}]::text[]
      WHERE organization_id = ${organizationId}
        AND provider = ${SAMPLE_PROVIDER}
        AND (acl_subjects IS NULL OR cardinality(acl_subjects) = 0)
    `);
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
      // Match the org-scoped ACL real chunkers use so the agent's search tool
      // (which filters chunks via `acl_subjects && userSubjects`) can reach
      // sample rows. Without this they default to '{}' and never match.
      aclSubjects: [`org:${organizationId}`],
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
  /**
   * Per-kind artifact counts (e.g. { doc: 3, message: 3, issue: 3 }). Empty
   * when the sample isn't installed. Powers the breakdown rendered in the
   * Manage sidebar — the same surface real connectors use for their content
   * snapshot.
   */
  kindBreakdown: Array<{ kind: string; count: number }>;
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
  if (!row) {
    return { active: false, artifactCount: 0, installedAt: null, kindBreakdown: [] };
  }

  const breakdownRows = await db
    .select({
      kind: sourceArtifacts.kind,
      count: sql<number>`count(*)::int`,
    })
    .from(sourceArtifacts)
    .where(eq(sourceArtifacts.sourceId, row.id))
    .groupBy(sourceArtifacts.kind);

  return {
    active: true,
    artifactCount: row.count ?? 0,
    installedAt: row.createdAt.toISOString(),
    kindBreakdown: breakdownRows
      .map((r) => ({ kind: r.kind, count: r.count }))
      .sort((a, b) => b.count - a.count),
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
