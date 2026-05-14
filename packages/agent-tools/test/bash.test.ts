import { describe, it, expect } from 'vitest';
import { runBashTool } from '../src/tools/bash';
import type { DB } from '@holo/db';

// Build a stub DB that returns hard-coded rows from a tiny in-memory tree.
// This exercises the bash → HoloFs → SQL path without needing Postgres.
function makeStubDb(): DB {
  type Row = { path: string; id: string; kind: string; content: string };
  const rows: Row[] = [
    { path: '/slack/#general/2026-05-14/thread-1.md', id: 'a1', kind: 'slack-thread', content: 'hello world from general' },
    { path: '/slack/#general/2026-05-14/thread-2.md', id: 'a2', kind: 'slack-thread', content: 'rippling pricing thread' },
    { path: '/notion/sales/playbook.md', id: 'a3', kind: 'notion-page', content: 'sales playbook' },
  ];

  const exec = async <T,>(query: { strings?: string[]; queryChunks?: Array<{ value?: string[] }> }) => {
    // Pull out the rendered SQL from drizzle's template. drizzle exposes
    // `.queryChunks` and `.params`; we don't need to parse — we just match
    // crude shape patterns and return canned rows.
    const sqlText = JSON.stringify(query).toLowerCase();
    const rowsToReturn = sqlText.includes("name <> ''")
      // readdir at root: emit unique top-level segments.
      ? [
          { name: 'notion', kind: 'directory' as const },
          { name: 'slack', kind: 'directory' as const },
        ]
      : sqlText.includes('exists')
        ? [{ exists: true }]
        : sqlText.includes('select id, kind')
          ? [{ id: 'a1', kind: 'slack-thread' }]
          : sqlText.includes('count(*)')
            ? [{ total: 1 }]
            : sqlText.includes('source_artifact_id')
              ? [
                  {
                    source_artifact_id: 'a1',
                    kind: 'slack-thread',
                    content: rows[0]!.content,
                    metadata: { channel_name: 'general', thread_ts: 't' },
                    created_at: new Date().toISOString(),
                    acl_subjects: ['org:test'],
                  },
                ]
              : [];
    return { rows: rowsToReturn } as unknown as T;
  };

  return { execute: exec } as unknown as DB;
}

describe('bash tool (no-DB smoke)', () => {
  it('rejects empty script via Zod', async () => {
    const ctx = {
      db: makeStubDb(),
      organizationId: 'org-test',
      userSubjects: ['org:test'],
    };
    await expect(runBashTool(ctx, { script: '' })).rejects.toThrow();
  });

  it('runs `echo hi` and returns stdout', async () => {
    const ctx = {
      db: makeStubDb(),
      organizationId: 'org-test',
      userSubjects: ['org:test'],
    };
    const out = await runBashTool(ctx, { script: 'echo hi' });
    expect(out.exit_code).toBe(0);
    expect(out.stdout.trim()).toBe('hi');
  });

  it('rejects an unknown command (not in allowlist)', async () => {
    const ctx = {
      db: makeStubDb(),
      organizationId: 'org-test',
      userSubjects: ['org:test'],
    };
    // `curl` is not in V1 allowlist. Just-bash returns non-zero with a
    // command-not-found-ish stderr.
    const out = await runBashTool(ctx, { script: 'curl example.com' });
    expect(out.exit_code).not.toBe(0);
    expect(out.stderr.length).toBeGreaterThan(0);
  });
});
