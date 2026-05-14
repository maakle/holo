/**
 * Multi-tenant ACL test fixture. Seeds two organizations with overlapping
 * path schemes, three users per org with progressively narrower ACL
 * subjects, and artifacts at the org / channel / page-tree granularity
 * so we can adversarially test cross-tenant + cross-user enforcement.
 *
 * Used by acl.test.ts and fs.test.ts. Idempotent: caller wipes via
 * `wipeFixture(db, prefix)` between runs.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';

export interface FixtureOrg {
  id: string;
  slug: string;
  sourceId: string;
  /** Subjects an "admin"-level user can prove (org + every channel + every tree). */
  adminSubjects: string[];
  /** Subjects a "restricted" user has (org only — no per-channel grants). */
  restrictedSubjects: string[];
  /** Subjects a "no-access" user has (none). */
  noAccessSubjects: string[];
  artifactIds: { path: string; id: string }[];
}

export interface Fixture {
  orgA: FixtureOrg;
  orgB: FixtureOrg;
}

interface RawId {
  id: string;
}

function unwrap<T>(result: unknown): T[] {
  const r = result as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : r.rows ?? [];
}

function pgTextArrayLiteral(values: string[]): string {
  const escaped = values.map(
    (v) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(',')}}`;
}

export async function seedFixture(db: DB, prefix: string): Promise<Fixture> {
  const slugA = `${prefix}-a`;
  const slugB = `${prefix}-b`;
  // 1. Orgs.
  const orgARes = await db.execute<RawId>(sql`
    INSERT INTO organization (slug, name) VALUES (${slugA}, ${'fixture ' + slugA})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const orgBRes = await db.execute<RawId>(sql`
    INSERT INTO organization (slug, name) VALUES (${slugB}, ${'fixture ' + slugB})
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `);
  const orgAId = unwrap<RawId>(orgARes)[0]!.id;
  const orgBId = unwrap<RawId>(orgBRes)[0]!.id;

  const orgs: FixtureOrg[] = [];
  for (const [orgId, orgSlug] of [
    [orgAId, slugA],
    [orgBId, slugB],
  ] as const) {
    // 2. Source.
    const sourceRes = await db.execute<RawId>(sql`
      INSERT INTO sources (organization_id, provider, external_id, name)
      VALUES (${orgId}, 'slack', ${'src-' + orgSlug}, ${'fixture-slack-' + orgSlug})
      ON CONFLICT (organization_id, provider, external_id) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `);
    const sourceId = unwrap<RawId>(sourceRes)[0]!.id;

    // 3. Artifacts: a public Slack thread (`#general`), a private one
    //    (`#exec-pay`), and a Notion page in a tree-restricted subtree.
    const artifacts: Array<{
      path: string;
      kind: string;
      externalId: string;
      acl: string[];
      content: string;
      metadata: Record<string, unknown>;
    }> = [
      {
        path: `/slack/#general/2026-05-14/thread-${orgSlug}-1.md`,
        kind: 'slack-thread',
        externalId: `slack-thread:CGEN:${orgSlug}-1`,
        acl: [`org:${orgId}`, `slack-channel:CGEN-${orgSlug}`],
        content: `[fixture] ${orgSlug} general thread`,
        metadata: { channel_name: 'general', thread_ts: '1715000000.000100' },
      },
      {
        path: `/slack/#exec-pay/2026-05-14/thread-${orgSlug}-2.md`,
        kind: 'slack-thread',
        externalId: `slack-thread:CEXEC:${orgSlug}-2`,
        acl: [`org:${orgId}`, `slack-channel:CEXEC-${orgSlug}`],
        content: `[fixture] ${orgSlug} exec-pay thread (restricted)`,
        metadata: { channel_name: 'exec-pay', thread_ts: '1715000001.000200' },
      },
      {
        path: `/notion/sales/playbook-${orgSlug}.md`,
        kind: 'notion-page',
        externalId: `notion-page:${orgSlug}-pb`,
        acl: [`org:${orgId}`, `notion-page-tree:tree-${orgSlug}-sales`],
        content: `[fixture] ${orgSlug} sales playbook`,
        metadata: { notion_page_id: `pg-${orgSlug}-pb`, breadcrumb: 'Sales' },
      },
    ];

    const artifactIds: { path: string; id: string }[] = [];
    for (const a of artifacts) {
      const aRes = await db.execute<RawId>(sql`
        INSERT INTO source_artifacts
          (organization_id, source_id, kind, external_id, fetched_at, payload, path, acl_subjects)
        VALUES (
          ${orgId}, ${sourceId}, ${a.kind}, ${a.externalId}, now(), '{}'::jsonb,
          ${a.path}, ${pgTextArrayLiteral(a.acl)}::text[]
        )
        ON CONFLICT (source_id, external_id) DO UPDATE SET
          path = EXCLUDED.path,
          acl_subjects = EXCLUDED.acl_subjects
        RETURNING id
      `);
      const artifactId = unwrap<RawId>(aRes)[0]!.id;
      artifactIds.push({ path: a.path, id: artifactId });

      const hash = `hash-${orgSlug}-${a.externalId}-${Math.random().toString(36).slice(2)}`;
      await db.execute(sql`
        INSERT INTO chunks
          (organization_id, source_id, source_artifact_id, kind, content, content_hash,
           provider, metadata, acl_subjects)
        VALUES (
          ${orgId}, ${sourceId}, ${artifactId}, ${a.kind}, ${a.content},
          ${hash}, 'slack', ${JSON.stringify(a.metadata)}::jsonb,
          ${pgTextArrayLiteral(a.acl)}::text[]
        )
        ON CONFLICT (organization_id, content_hash) DO NOTHING
      `);
    }

    orgs.push({
      id: orgId,
      slug: orgSlug,
      sourceId,
      adminSubjects: [
        `org:${orgId}`,
        `slack-channel:CGEN-${orgSlug}`,
        `slack-channel:CEXEC-${orgSlug}`,
        `notion-page-tree:tree-${orgSlug}-sales`,
      ],
      restrictedSubjects: [`org:${orgId}`, `slack-channel:CGEN-${orgSlug}`],
      noAccessSubjects: [],
      artifactIds,
    });
  }

  return { orgA: orgs[0]!, orgB: orgs[1]! };
}

export async function wipeFixture(db: DB, prefix: string): Promise<void> {
  // The cascade chain: organization → sources → source_artifacts → chunks.
  await db.execute(sql`
    DELETE FROM organization WHERE slug IN (${prefix + '-a'}, ${prefix + '-b'})
  `);
}
