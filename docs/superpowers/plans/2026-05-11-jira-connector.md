# Jira Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Jira Cloud as an `implemented: true` connector that indexes issues, inline comments, and project metadata into Holo via a paste-token wizard (site URL + email + API token, basic auth).

**Architecture:** Single connector spec (`createJiraSpec`) with two resources (`issues` emitting both issue and comment chunks; `projects`). Per-tenant base URL lives on `sources.metadata.siteUrl` (Mintlify pattern). Inside each resource, the spec constructs its own per-tenant `HttpClient` via the framework's `createHttpClient` factory so we keep retry, rate-limit, and basic-auth header injection without modifying the framework. ADF (Atlassian Document Format) bodies are flattened to plain text via a small in-package renderer.

**Tech Stack:** TypeScript, `@holo/connector-framework` (`apiKey({ prefix: 'Basic ' })`, `defineConnector`, `createHttpClient`), `zod`, `vitest`, Next.js App Router (web), NestJS BullMQ (worker), Drizzle ORM.

**Design spec:** [docs/superpowers/specs/2026-05-11-jira-connector-design.md](../specs/2026-05-11-jira-connector-design.md)

---

## File Structure

**New files:**

- `packages/connectors/src/jira/index.ts` — re-export `createJiraSpec` and public types
- `packages/connectors/src/jira/spec.ts` — `defineConnector(...)` factory, per-tenant `HttpClient` construction inside each resource
- `packages/connectors/src/jira/api.ts` — narrowly-typed wrappers around `/rest/api/3/search/jql`, `/rest/api/3/project/search`, `/rest/api/3/myself`, `/rest/api/3/serverInfo`
- `packages/connectors/src/jira/types.ts` — response shapes (issues, comments, projects, myself, serverInfo, ADF nodes)
- `packages/connectors/src/jira/chunking.ts` — `processIssue`, `processComment`, `processProject`
- `packages/connectors/src/jira/adf.ts` — ADF tree → plain text
- `packages/connectors/test/jira/adf.test.ts`
- `packages/connectors/test/jira/chunking.test.ts`
- `packages/connectors/test/jira/spec.test.ts`
- `packages/connectors/test/jira/fixtures/issues-page-1.json`
- `packages/connectors/test/jira/fixtures/issues-page-2.json`
- `packages/connectors/test/jira/fixtures/projects-page-1.json`
- `apps/web/src/app/api/connectors/jira/connect/route.ts`
- `apps/web/src/app/api/connectors/jira/connect/route.test.ts`
- `apps/web/src/components/connection-wizard/steps/jira-credentials-step.tsx`
- `docs/connectors/jira.md`

**Modified files:**

- `packages/sync-providers/src/index.ts` — append `'jira'` to `SYNC_PROVIDERS` and add `'jira'` entry to `QUEUE_NAMES_BY_PROVIDER`
- `packages/connectors/src/sync-intervals.ts` — add `jira: 4 * HOUR_MS`
- `packages/connectors/src/index.ts` — export `createJiraSpec`, `JiraSpecOptions`
- `apps/web/src/lib/connector-registry.ts` — flip `jira` to `implemented: true`, `flowType: 'apikey'`
- `apps/web/src/components/connection-wizard/configs.tsx` — register `jiraConfig`
- `apps/worker/src/queues/types.ts` — add `JIRA_SYNC` to `QUEUE_NAMES` + `QUEUE_CONCURRENCY`
- `apps/worker/src/queues/runners.module.ts` — import `createJiraSpec`, register on `QUEUE_NAMES.JIRA_SYNC`
- `apps/worker/src/queues/framework-bridge.ts` — extend the two hand-rolled provider-id type casts to include `'jira'`

**No database migration required.** `connector_credentials.provider` is plain `text` with no DB-level CHECK constraint; adding `'jira'` to `SYNC_PROVIDERS` is a pure TypeScript change. Verified against `packages/db/migrations/meta/0036_snapshot.json` (column type `"text"`, no enum constraint).

---

## Task 1: Register Jira in `@holo/sync-providers`

**Files:**
- Modify: `packages/sync-providers/src/index.ts`

- [ ] **Step 1: Add `'jira'` to `SYNC_PROVIDERS` and `QUEUE_NAMES_BY_PROVIDER`**

Edit `packages/sync-providers/src/index.ts`. Append `'jira'` after `'google-chat'` in `SYNC_PROVIDERS`:

```ts
export const SYNC_PROVIDERS = [
  'github',
  'gitlab',
  'slack',
  'notion',
  'grain',
  'pylon',
  'hubspot',
  'linear',
  'mintlify',
  'zendesk',
  'googledrive',
  'airtable',
  'google-chat',
  'jira',
] as const;
```

And add a `jira` entry to `QUEUE_NAMES_BY_PROVIDER` (after `'google-chat'`):

```ts
export const QUEUE_NAMES_BY_PROVIDER = {
  github: ['github-code-sync', 'github-prose-sync'],
  gitlab: ['gitlab-code-sync', 'gitlab-prose-sync'],
  slack: ['slack-sync'],
  notion: ['notion-sync'],
  grain: ['grain-sync'],
  pylon: ['pylon-sync'],
  hubspot: ['hubspot-sync'],
  linear: ['linear-sync'],
  mintlify: ['mintlify-sync'],
  zendesk: ['zendesk-sync'],
  googledrive: ['googledrive-sync'],
  airtable: ['airtable-sync'],
  'google-chat': ['google-chat-sync'],
  jira: ['jira-sync'],
} as const satisfies Record<SyncProvider, readonly string[]>;
```

- [ ] **Step 2: Type-check the package**

Run: `pnpm --filter @holo/sync-providers typecheck`
Expected: PASS. The `satisfies Record<SyncProvider, ...>` guard ensures the queue map covers every provider — if you forget to add the `jira` line in either place, this fails the build.

- [ ] **Step 3: Commit**

```bash
git add packages/sync-providers/src/index.ts
git commit -m "feat(sync-providers): register jira provider + queue"
```

---

## Task 2: Add Jira sync cadence

**Files:**
- Modify: `packages/connectors/src/sync-intervals.ts`

- [ ] **Step 1: Add `jira: 4 * HOUR_MS`**

Append the line after `'google-chat': 4 * HOUR_MS,` in `SYNC_INTERVAL_MS_BY_PROVIDER`:

```ts
export const SYNC_INTERVAL_MS_BY_PROVIDER: Record<SyncProvider, number> = {
  slack: 4 * HOUR_MS,
  linear: 4 * HOUR_MS,
  zendesk: 6 * HOUR_MS,
  hubspot: 6 * HOUR_MS,
  pylon: 6 * HOUR_MS,
  github: 6 * HOUR_MS,
  gitlab: 6 * HOUR_MS,
  grain: 12 * HOUR_MS,
  notion: 24 * HOUR_MS,
  mintlify: 24 * HOUR_MS,
  googledrive: 6 * HOUR_MS,
  airtable: 6 * HOUR_MS,
  'google-chat': 4 * HOUR_MS,
  jira: 4 * HOUR_MS,
};
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/connectors typecheck`
Expected: PASS. The `Record<SyncProvider, number>` will fail if `'jira'` is missing now that step 1 of Task 1 added it to `SYNC_PROVIDERS`.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/sync-intervals.ts
git commit -m "feat(connectors): add jira 4h sync cadence"
```

---

## Task 3: ADF (Atlassian Document Format) → plain text — failing tests first

**Files:**
- Create: `packages/connectors/test/jira/adf.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from 'vitest';
import { adfToPlainText } from '../../src/jira/adf';

describe('adfToPlainText', () => {
  it('returns empty string for null / undefined / non-object input', () => {
    expect(adfToPlainText(null)).toBe('');
    expect(adfToPlainText(undefined)).toBe('');
    expect(adfToPlainText('not adf')).toBe('');
    expect(adfToPlainText({})).toBe('');
  });

  it('renders a single paragraph with inline text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('Hello world');
  });

  it('separates paragraphs with a blank line', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('First\n\nSecond');
  });

  it('prefixes headings with # markers by level', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Top' }] },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Sub' }] },
        { type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'Deep' }] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('# Top\n\n## Sub\n\n###### Deep');
  });

  it('renders bullet lists with "- " prefix', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('- one\n- two');
  });

  it('renders ordered lists with "1. " "2. " prefixes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
            },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('1. one\n2. two');
  });

  it('fences code blocks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'ts' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('```ts\nconst x = 1;\n```');
  });

  it('renders hardBreak as a newline within a paragraph', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'line1' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line2' },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('line1\nline2');
  });

  it('renders mentions as @DisplayName', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'cc ' },
            { type: 'mention', attrs: { text: '@Jane Doe', id: 'abc' } },
          ],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('cc @Jane Doe');
  });

  it('substitutes placeholders for media and table nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'mediaSingle',
          content: [{ type: 'media', attrs: { alt: 'diagram.png' } }],
        },
        { type: 'table', content: [] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('[image: diagram.png]\n\n[table]');
  });

  it('falls back to recursing into content for unknown node types', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'someFutureNodeType',
          content: [{ type: 'text', text: 'still extracted' }],
        },
      ],
    };
    expect(adfToPlainText(doc)).toBe('still extracted');
  });

  it('trims leading and trailing whitespace from the final result', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
        { type: 'paragraph', content: [] },
      ],
    };
    expect(adfToPlainText(doc)).toBe('body');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @holo/connectors test -- test/jira/adf.test.ts`
Expected: FAIL with "Cannot find module '../../src/jira/adf'".

---

## Task 4: ADF renderer implementation

**Files:**
- Create: `packages/connectors/src/jira/adf.ts`

- [ ] **Step 1: Implement `adfToPlainText`**

```ts
type AdfNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
};

function isObject(value: unknown): value is AdfNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderInline(nodes: AdfNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) {
    if (!isObject(node)) continue;
    switch (node.type) {
      case 'text':
        out += typeof node.text === 'string' ? node.text : '';
        break;
      case 'hardBreak':
        out += '\n';
        break;
      case 'mention': {
        const text = node.attrs && typeof node.attrs.text === 'string' ? node.attrs.text : '';
        out += text;
        break;
      }
      case 'inlineCard':
      case 'link': {
        const url = node.attrs && typeof node.attrs.url === 'string' ? node.attrs.url : '';
        out += url;
        break;
      }
      case 'emoji': {
        const shortName =
          node.attrs && typeof node.attrs.shortName === 'string' ? node.attrs.shortName : '';
        out += shortName;
        break;
      }
      default:
        // Unknown inline node — recurse so nested text still surfaces.
        out += renderInline(node.content);
    }
  }
  return out;
}

function renderListItems(items: AdfNode[] | undefined, ordered: boolean): string {
  if (!items) return '';
  const lines: string[] = [];
  let idx = 0;
  for (const item of items) {
    if (!isObject(item) || item.type !== 'listItem') continue;
    idx += 1;
    const prefix = ordered ? `${idx}. ` : '- ';
    const body = renderBlocks(item.content).trim();
    if (body.length === 0) continue;
    // Indent secondary lines so multi-paragraph list items stay grouped.
    const indented = body.split('\n').join('\n  ');
    lines.push(`${prefix}${indented}`);
  }
  return lines.join('\n');
}

function renderBlocks(nodes: AdfNode[] | undefined): string {
  if (!nodes) return '';
  const blocks: string[] = [];
  for (const node of nodes) {
    if (!isObject(node)) continue;
    switch (node.type) {
      case 'paragraph': {
        const text = renderInline(node.content);
        if (text.length > 0) blocks.push(text);
        break;
      }
      case 'heading': {
        const level =
          node.attrs && typeof node.attrs.level === 'number'
            ? Math.min(Math.max(node.attrs.level, 1), 6)
            : 1;
        const text = renderInline(node.content);
        if (text.length > 0) blocks.push(`${'#'.repeat(level)} ${text}`);
        break;
      }
      case 'bulletList':
        blocks.push(renderListItems(node.content, false));
        break;
      case 'orderedList':
        blocks.push(renderListItems(node.content, true));
        break;
      case 'codeBlock': {
        const language =
          node.attrs && typeof node.attrs.language === 'string' ? node.attrs.language : '';
        const text = renderInline(node.content);
        blocks.push(`\`\`\`${language}\n${text}\n\`\`\``);
        break;
      }
      case 'blockquote': {
        const inner = renderBlocks(node.content).trim();
        if (inner.length > 0) {
          blocks.push(
            inner
              .split('\n')
              .map((line) => (line.length > 0 ? `> ${line}` : '>'))
              .join('\n'),
          );
        }
        break;
      }
      case 'rule':
        blocks.push('---');
        break;
      case 'mediaSingle':
      case 'mediaGroup': {
        // Walk one level in to find a `media` child for the alt.
        const inner = node.content?.find((c) => isObject(c) && c.type === 'media');
        const alt =
          inner && isObject(inner) && inner.attrs && typeof inner.attrs.alt === 'string'
            ? inner.attrs.alt
            : '';
        blocks.push(`[image${alt ? `: ${alt}` : ''}]`);
        break;
      }
      case 'media': {
        const alt =
          node.attrs && typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
        blocks.push(`[image${alt ? `: ${alt}` : ''}]`);
        break;
      }
      case 'table':
        blocks.push('[table]');
        break;
      case 'panel':
      case 'expand': {
        const inner = renderBlocks(node.content).trim();
        if (inner.length > 0) blocks.push(inner);
        break;
      }
      default: {
        // Unknown block — recurse so the text inside isn't dropped.
        const inner = renderBlocks(node.content);
        if (inner.length > 0) blocks.push(inner);
      }
    }
  }
  return blocks.filter((b) => b.length > 0).join('\n\n');
}

/**
 * Best-effort plain-text rendering of an Atlassian Document Format tree.
 * Unknown node types fall back to recursing into `content`, so future
 * Atlassian additions degrade gracefully rather than silently dropping text.
 * Returns '' for null / non-object input.
 */
export function adfToPlainText(doc: unknown): string {
  if (!isObject(doc)) return '';
  return renderBlocks(doc.content).trim();
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `pnpm --filter @holo/connectors test -- test/jira/adf.test.ts`
Expected: PASS, 12 passed.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/jira/adf.ts packages/connectors/test/jira/adf.test.ts
git commit -m "feat(connectors/jira): add ADF → plain-text renderer"
```

---

## Task 5: Jira response types

**Files:**
- Create: `packages/connectors/src/jira/types.ts`

- [ ] **Step 1: Write the type module**

```ts
/**
 * Narrowly-typed shapes for the Jira Cloud REST v3 endpoints we call.
 * Only fields we project into chunks or metadata are typed — every
 * unused field is omitted on purpose so the surface stays small.
 *
 * Endpoints:
 *  - POST /rest/api/3/search/jql          (issues + inline comments)
 *  - GET  /rest/api/3/project/search       (projects, paginated)
 *  - GET  /rest/api/3/myself               (testConnection / connect-route validation)
 *  - GET  /rest/api/3/serverInfo           (cloudId for sources.externalId)
 */

export interface JiraMyself {
  accountId: string;
  emailAddress?: string;
  displayName: string;
}

export interface JiraServerInfo {
  baseUrl: string;
  /** Cloud-only field; absent on Jira Server. We only support Cloud. */
  serverTitle?: string;
  cloudId?: string;
  version?: string;
}

export interface JiraUserRef {
  accountId: string;
  displayName: string;
  emailAddress?: string;
}

export interface JiraStatus {
  id: string;
  name: string;
  statusCategory?: { key: string; name: string };
}

export interface JiraIssueType {
  id: string;
  name: string;
}

export interface JiraPriority {
  id: string;
  name: string;
}

export interface JiraProjectRef {
  id: string;
  key: string;
  name: string;
}

export interface JiraComment {
  id: string;
  author?: JiraUserRef;
  body?: unknown; // ADF document
  created: string;
  updated: string;
}

export interface JiraIssueFields {
  summary: string;
  description?: unknown; // ADF document or null
  status: JiraStatus;
  issuetype: JiraIssueType;
  priority?: JiraPriority | null;
  assignee?: JiraUserRef | null;
  reporter?: JiraUserRef | null;
  project: JiraProjectRef;
  labels?: string[];
  created: string;
  updated: string;
  comment?: { comments: JiraComment[]; total?: number };
}

export interface JiraIssue {
  id: string;
  key: string;
  /** Self URL — useful for building the user-facing browse link. */
  self: string;
  fields: JiraIssueFields;
}

/**
 * Response shape for POST /rest/api/3/search/jql.
 * Atlassian retired `startAt`/`maxResults` here in favor of opaque
 * `nextPageToken`; `isLast` is the terminal signal.
 */
export interface JiraIssueSearchResponse {
  issues: JiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  description?: string;
  lead?: JiraUserRef;
  self?: string;
}

/**
 * Response shape for GET /rest/api/3/project/search.
 * Page-based with `isLast` for termination.
 */
export interface JiraProjectSearchResponse {
  values: JiraProject[];
  startAt: number;
  maxResults: number;
  total?: number;
  isLast: boolean;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/connectors typecheck`
Expected: PASS (file is types-only with no implementation dependencies).

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/jira/types.ts
git commit -m "feat(connectors/jira): add Jira REST v3 response types"
```

---

## Task 6: API helpers — failing tests first

**Files:**
- Create: `packages/connectors/test/jira/fixtures/issues-page-1.json`
- Create: `packages/connectors/test/jira/fixtures/issues-page-2.json`
- Create: `packages/connectors/test/jira/fixtures/projects-page-1.json`

We'll exercise `api.ts` indirectly via the spec test (Task 12). For now, drop in the fixtures that subsequent tasks consume so we have one source of truth for shapes.

- [ ] **Step 1: Write `issues-page-1.json`**

```json
{
  "issues": [
    {
      "id": "10001",
      "key": "ENG-1",
      "self": "https://acme.atlassian.net/rest/api/3/issue/10001",
      "fields": {
        "summary": "Hook up retrieval health endpoint",
        "description": {
          "type": "doc",
          "content": [
            {
              "type": "paragraph",
              "content": [
                { "type": "text", "text": "Wire the dashboard to /api/health." }
              ]
            }
          ]
        },
        "status": {
          "id": "1",
          "name": "In Progress",
          "statusCategory": { "key": "indeterminate", "name": "In Progress" }
        },
        "issuetype": { "id": "10001", "name": "Story" },
        "priority": { "id": "3", "name": "Medium" },
        "assignee": {
          "accountId": "u-jane",
          "displayName": "Jane Doe",
          "emailAddress": "jane@acme.test"
        },
        "reporter": { "accountId": "u-mike", "displayName": "Mike Smith" },
        "project": { "id": "p-1", "key": "ENG", "name": "Engineering" },
        "labels": ["backend", "p1"],
        "created": "2026-05-01T09:00:00.000+0000",
        "updated": "2026-05-09T15:22:00.000+0000",
        "comment": {
          "total": 1,
          "comments": [
            {
              "id": "c-100",
              "author": { "accountId": "u-jane", "displayName": "Jane Doe" },
              "body": {
                "type": "doc",
                "content": [
                  {
                    "type": "paragraph",
                    "content": [{ "type": "text", "text": "Should we cache the result?" }]
                  }
                ]
              },
              "created": "2026-05-09T14:00:00.000+0000",
              "updated": "2026-05-09T14:00:00.000+0000"
            }
          ]
        }
      }
    },
    {
      "id": "10002",
      "key": "ENG-2",
      "self": "https://acme.atlassian.net/rest/api/3/issue/10002",
      "fields": {
        "summary": "Document the worker queue topology",
        "description": null,
        "status": {
          "id": "10",
          "name": "Done",
          "statusCategory": { "key": "done", "name": "Done" }
        },
        "issuetype": { "id": "10002", "name": "Task" },
        "priority": null,
        "assignee": null,
        "reporter": { "accountId": "u-mike", "displayName": "Mike Smith" },
        "project": { "id": "p-1", "key": "ENG", "name": "Engineering" },
        "labels": [],
        "created": "2026-05-02T09:00:00.000+0000",
        "updated": "2026-05-08T12:00:00.000+0000",
        "comment": { "total": 0, "comments": [] }
      }
    }
  ],
  "nextPageToken": "page-2-token",
  "isLast": false
}
```

- [ ] **Step 2: Write `issues-page-2.json`**

```json
{
  "issues": [
    {
      "id": "10003",
      "key": "OPS-1",
      "self": "https://acme.atlassian.net/rest/api/3/issue/10003",
      "fields": {
        "summary": "Rotate Atlassian admin token",
        "description": {
          "type": "doc",
          "content": [
            {
              "type": "paragraph",
              "content": [{ "type": "text", "text": "Quarterly rotation." }]
            }
          ]
        },
        "status": {
          "id": "1",
          "name": "To Do",
          "statusCategory": { "key": "new", "name": "To Do" }
        },
        "issuetype": { "id": "10003", "name": "Chore" },
        "priority": { "id": "2", "name": "High" },
        "assignee": null,
        "reporter": { "accountId": "u-mike", "displayName": "Mike Smith" },
        "project": { "id": "p-2", "key": "OPS", "name": "Operations" },
        "labels": ["security"],
        "created": "2026-05-03T09:00:00.000+0000",
        "updated": "2026-05-10T08:00:00.000+0000",
        "comment": { "total": 0, "comments": [] }
      }
    }
  ],
  "isLast": true
}
```

- [ ] **Step 3: Write `projects-page-1.json`**

```json
{
  "values": [
    {
      "id": "p-1",
      "key": "ENG",
      "name": "Engineering",
      "projectTypeKey": "software",
      "description": "Backend & infra.",
      "lead": { "accountId": "u-jane", "displayName": "Jane Doe" }
    },
    {
      "id": "p-2",
      "key": "OPS",
      "name": "Operations",
      "projectTypeKey": "business",
      "description": "",
      "lead": { "accountId": "u-mike", "displayName": "Mike Smith" }
    }
  ],
  "startAt": 0,
  "maxResults": 50,
  "total": 2,
  "isLast": true
}
```

- [ ] **Step 4: Commit fixtures**

```bash
git add packages/connectors/test/jira/fixtures/
git commit -m "test(connectors/jira): add response fixtures"
```

---

## Task 7: API helpers implementation

**Files:**
- Create: `packages/connectors/src/jira/api.ts`

The helpers wrap the framework's `HttpClient` (constructed per-tenant inside the spec) and surface narrow return types. No tests in this task — the spec test in Task 12 covers them end-to-end with mocked fetch.

- [ ] **Step 1: Write `api.ts`**

```ts
import { ErrorCode, holoError } from '@holo/errors';
import type { HttpClient } from '@holo/connector-framework';
import type {
  JiraIssueSearchResponse,
  JiraMyself,
  JiraProjectSearchResponse,
  JiraServerInfo,
} from './types';

const PROJECT_FIELDS = [
  'summary',
  'description',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'project',
  'labels',
  'created',
  'updated',
  'comment',
] as const;

/**
 * Build the JQL clause for the issues resource. Anchors first-sync at the
 * unix epoch (mirrors Linear) so the `updated >= "..."` filter never has a
 * null variable. Resulting clause includes `ORDER BY updated ASC` so the
 * cursor watermark advances monotonically across pages.
 */
export function buildIssuesJql(since: string | undefined): string {
  const ts = since ?? '1970-01-01 00:00';
  return `updated >= "${ts}" ORDER BY updated ASC`;
}

/**
 * POST /rest/api/3/search/jql — Atlassian's v3 successor to the deprecated
 * `/search` endpoint. Token-based pagination via `nextPageToken`.
 */
export async function searchIssues(
  api: HttpClient,
  input: { jql: string; nextPageToken?: string; pageSize?: number },
): Promise<JiraIssueSearchResponse> {
  return api.post<JiraIssueSearchResponse>('/rest/api/3/search/jql', {
    jql: input.jql,
    nextPageToken: input.nextPageToken,
    maxResults: input.pageSize ?? 50,
    fields: PROJECT_FIELDS,
    fieldsByKeys: false,
  });
}

/**
 * GET /rest/api/3/project/search — offset-based pagination via startAt.
 */
export async function searchProjects(
  api: HttpClient,
  input: { startAt: number; pageSize?: number },
): Promise<JiraProjectSearchResponse> {
  return api.get<JiraProjectSearchResponse>('/rest/api/3/project/search', {
    query: {
      startAt: input.startAt,
      maxResults: input.pageSize ?? 50,
      expand: 'description,lead',
    },
  });
}

export async function fetchMyself(api: HttpClient): Promise<JiraMyself> {
  return api.get<JiraMyself>('/rest/api/3/myself');
}

export async function fetchServerInfo(api: HttpClient): Promise<JiraServerInfo> {
  return api.get<JiraServerInfo>('/rest/api/3/serverInfo');
}

/**
 * Normalize a user-supplied site URL to `https://<host>` with no trailing
 * slash and no path. Accepts:
 *   - acme.atlassian.net
 *   - http://acme.atlassian.net
 *   - https://acme.atlassian.net/
 *   - https://acme.atlassian.net/jira/your-work
 * Throws HOLO_INVALID_INPUT if the host isn't a parseable URL.
 */
export function normalizeSiteUrl(raw: string): string {
  const trimmed = raw.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `"${raw}" is not a valid site URL`,
      fix: 'Use the form https://yourcompany.atlassian.net (paste from your browser address bar on any Jira page).',
    });
  }
  return `https://${parsed.host.toLowerCase()}`;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/connectors typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/jira/api.ts
git commit -m "feat(connectors/jira): add REST v3 API helpers + URL normalizer"
```

---

## Task 8: Chunking — failing tests first

**Files:**
- Create: `packages/connectors/test/jira/chunking.test.ts`

- [ ] **Step 1: Write the failing test file**

```ts
import { describe, it, expect } from 'vitest';
import { processIssue, processProject } from '../../src/jira/chunking';
import type {
  JiraIssue,
  JiraProject,
} from '../../src/jira/types';
import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';

function makeCtx() {
  const upserts: ChunkUpsert[] = [];
  const ctx = {
    upsert: async (chunk: ChunkUpsert) => {
      upserts.push(chunk);
    },
  } as unknown as ResourceSyncContext<unknown>;
  return { ctx, upserts };
}

const issueWithComment: JiraIssue = {
  id: '10001',
  key: 'ENG-1',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10001',
  fields: {
    summary: 'Hook up retrieval health endpoint',
    description: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Wire the dashboard to /api/health.' }],
        },
      ],
    },
    status: {
      id: '1',
      name: 'In Progress',
      statusCategory: { key: 'indeterminate', name: 'In Progress' },
    },
    issuetype: { id: '10001', name: 'Story' },
    priority: { id: '3', name: 'Medium' },
    assignee: { accountId: 'u-jane', displayName: 'Jane Doe' },
    reporter: { accountId: 'u-mike', displayName: 'Mike Smith' },
    project: { id: 'p-1', key: 'ENG', name: 'Engineering' },
    labels: ['backend', 'p1'],
    created: '2026-05-01T09:00:00.000+0000',
    updated: '2026-05-09T15:22:00.000+0000',
    comment: {
      total: 1,
      comments: [
        {
          id: 'c-100',
          author: { accountId: 'u-jane', displayName: 'Jane Doe' },
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Should we cache the result?' }],
              },
            ],
          },
          created: '2026-05-09T14:00:00.000+0000',
          updated: '2026-05-09T14:00:00.000+0000',
        },
      ],
    },
  },
};

const issueNoDescriptionNoComments: JiraIssue = {
  id: '10002',
  key: 'ENG-2',
  self: 'https://acme.atlassian.net/rest/api/3/issue/10002',
  fields: {
    summary: 'Document the worker queue topology',
    description: null,
    status: {
      id: '10',
      name: 'Done',
      statusCategory: { key: 'done', name: 'Done' },
    },
    issuetype: { id: '10002', name: 'Task' },
    priority: null,
    assignee: null,
    reporter: { accountId: 'u-mike', displayName: 'Mike Smith' },
    project: { id: 'p-1', key: 'ENG', name: 'Engineering' },
    labels: [],
    created: '2026-05-02T09:00:00.000+0000',
    updated: '2026-05-08T12:00:00.000+0000',
    comment: { total: 0, comments: [] },
  },
};

const project: JiraProject = {
  id: 'p-1',
  key: 'ENG',
  name: 'Engineering',
  projectTypeKey: 'software',
  description: 'Backend & infra.',
  lead: { accountId: 'u-jane', displayName: 'Jane Doe' },
};

describe('processIssue', () => {
  it('emits one issue chunk and one comment chunk for an issue with one comment', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].kind).toBe('jira-issue');
    expect(upserts[1].kind).toBe('jira-comment');
  });

  it('issue chunk content has the bracketed key, summary, meta row, and description', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    const [issueChunk] = upserts;
    expect(issueChunk.content).toContain('[ENG-1] Hook up retrieval health endpoint');
    expect(issueChunk.content).toContain('Status: In Progress');
    expect(issueChunk.content).toContain('Type: Story');
    expect(issueChunk.content).toContain('Priority: Medium');
    expect(issueChunk.content).toContain('Assignee: Jane Doe');
    expect(issueChunk.content).toContain('Project: Engineering');
    expect(issueChunk.content).toContain('Labels: backend, p1');
    expect(issueChunk.content).toContain('Wire the dashboard to /api/health.');
  });

  it('uses jira:project:{id} and jira:org as ACL subjects', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[0].aclSubjects).toEqual(['jira:project:p-1', 'jira:org']);
    expect(upserts[1].aclSubjects).toEqual(['jira:project:p-1', 'jira:org']);
  });

  it('comment chunk shares the parent issue sourceArtifactId so cascades work', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[1].sourceArtifactId).toBe('jira-issue:10001');
    expect(upserts[1].externalId).toBe('10001:c-100');
  });

  it('issue metadata includes browse URL built from the site URL', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueWithComment, 'https://acme.atlassian.net');
    expect(upserts[0].metadata.url).toBe('https://acme.atlassian.net/browse/ENG-1');
  });

  it('handles an issue with no description, no assignee, no priority, no comments', async () => {
    const { ctx, upserts } = makeCtx();
    await processIssue(ctx, issueNoDescriptionNoComments, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].kind).toBe('jira-issue');
    expect(upserts[0].content).toContain('[ENG-2] Document the worker queue topology');
    expect(upserts[0].content).not.toContain('Priority:');
    expect(upserts[0].content).not.toContain('Assignee:');
    expect(upserts[0].content).not.toContain('Labels:');
  });
});

describe('processProject', () => {
  it('emits a jira-project chunk with key, name, lead, description', async () => {
    const { ctx, upserts } = makeCtx();
    await processProject(ctx, project, 'https://acme.atlassian.net');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].kind).toBe('jira-project');
    expect(upserts[0].content).toContain('[ENG] Engineering');
    expect(upserts[0].content).toContain('Type: software');
    expect(upserts[0].content).toContain('Lead: Jane Doe');
    expect(upserts[0].content).toContain('Backend & infra.');
    expect(upserts[0].aclSubjects).toEqual(['jira:org']);
    expect(upserts[0].metadata.url).toBe('https://acme.atlassian.net/jira/projects/ENG');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @holo/connectors test -- test/jira/chunking.test.ts`
Expected: FAIL with "Cannot find module '../../src/jira/chunking'".

---

## Task 9: Chunking implementation

**Files:**
- Create: `packages/connectors/src/jira/chunking.ts`

- [ ] **Step 1: Write `chunking.ts`**

```ts
import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';
import { adfToPlainText } from './adf';
import type { JiraIssue, JiraProject } from './types';

function buildIssueBrowseUrl(siteUrl: string, key: string): string {
  return `${siteUrl}/browse/${key}`;
}

function buildProjectUrl(siteUrl: string, key: string): string {
  return `${siteUrl}/jira/projects/${key}`;
}

function projectIssueToContent(issue: JiraIssue): string {
  const f = issue.fields;
  const lines: string[] = [];
  lines.push(`[${issue.key}] ${f.summary}`);

  const meta: string[] = [];
  meta.push(`Status: ${f.status.name}`);
  meta.push(`Type: ${f.issuetype.name}`);
  if (f.priority?.name) meta.push(`Priority: ${f.priority.name}`);
  if (f.assignee?.displayName) meta.push(`Assignee: ${f.assignee.displayName}`);
  meta.push(`Project: ${f.project.name}`);
  if (f.labels && f.labels.length > 0) meta.push(`Labels: ${f.labels.join(', ')}`);
  lines.push(meta.join(' · '));

  const description = adfToPlainText(f.description).trim();
  if (description.length > 0) {
    lines.push('');
    lines.push(description);
  }
  return lines.join('\n');
}

function aclFor(issue: JiraIssue): string[] {
  return [`jira:project:${issue.fields.project.id}`, 'jira:org'];
}

function issueMetadata(issue: JiraIssue, siteUrl: string): Record<string, unknown> {
  const f = issue.fields;
  return {
    key: issue.key,
    url: buildIssueBrowseUrl(siteUrl, issue.key),
    projectKey: f.project.key,
    projectId: f.project.id,
    statusName: f.status.name,
    statusCategory: f.status.statusCategory?.key ?? null,
    issueTypeName: f.issuetype.name,
    priority: f.priority?.name ?? null,
    assigneeId: f.assignee?.accountId ?? null,
    reporterId: f.reporter?.accountId ?? null,
    labels: f.labels ?? [],
    createdAt: f.created,
    updatedAt: f.updated,
  };
}

/**
 * Emit one `jira-issue` chunk + one `jira-comment` chunk per top-level
 * comment. All chunks share the parent issue's source-artifact id so
 * deletions of the issue cascade to its comment chunks.
 */
export async function processIssue(
  ctx: ResourceSyncContext<unknown>,
  issue: JiraIssue,
  siteUrl: string,
): Promise<void> {
  const sourceArtifactId = `jira-issue:${issue.id}`;
  const acl = aclFor(issue);

  const issueChunk: ChunkUpsert = {
    externalId: issue.id,
    kind: 'jira-issue',
    content: projectIssueToContent(issue),
    aclSubjects: acl,
    metadata: issueMetadata(issue, siteUrl),
    sourceArtifactId,
  };
  await ctx.upsert(issueChunk);

  const comments = issue.fields.comment?.comments ?? [];
  for (const c of comments) {
    const body = adfToPlainText(c.body).trim();
    const author = c.author?.displayName ?? 'Unknown';
    const header = `Comment by ${author} · ${c.created}`;
    const content = body.length > 0 ? `${header}\n\n${body}` : header;
    const commentChunk: ChunkUpsert = {
      externalId: `${issue.id}:${c.id}`,
      kind: 'jira-comment',
      content,
      aclSubjects: acl,
      metadata: {
        commentId: c.id,
        issueKey: issue.key,
        issueId: issue.id,
        projectId: issue.fields.project.id,
        authorId: c.author?.accountId ?? null,
        createdAt: c.created,
        updatedAt: c.updated,
      },
      sourceArtifactId,
    };
    await ctx.upsert(commentChunk);
  }
}

function projectProjectToContent(project: JiraProject): string {
  const lines: string[] = [];
  lines.push(`[${project.key}] ${project.name}`);

  const meta: string[] = [];
  if (project.projectTypeKey) meta.push(`Type: ${project.projectTypeKey}`);
  if (project.lead?.displayName) meta.push(`Lead: ${project.lead.displayName}`);
  if (meta.length > 0) lines.push(meta.join(' · '));

  const description = (project.description ?? '').trim();
  if (description.length > 0) {
    lines.push('');
    lines.push(description);
  }
  return lines.join('\n');
}

export async function processProject(
  ctx: ResourceSyncContext<unknown>,
  project: JiraProject,
  siteUrl: string,
): Promise<void> {
  const chunk: ChunkUpsert = {
    externalId: project.id,
    kind: 'jira-project',
    content: projectProjectToContent(project),
    aclSubjects: ['jira:org'],
    metadata: {
      key: project.key,
      name: project.name,
      projectTypeKey: project.projectTypeKey ?? null,
      leadId: project.lead?.accountId ?? null,
      url: buildProjectUrl(siteUrl, project.key),
    },
  };
  await ctx.upsert(chunk);
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `pnpm --filter @holo/connectors test -- test/jira/chunking.test.ts`
Expected: PASS, 7 passed.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/jira/chunking.ts packages/connectors/test/jira/chunking.test.ts
git commit -m "feat(connectors/jira): chunk issues, comments, projects"
```

---

## Task 10: Spec — failing test first

**Files:**
- Create: `packages/connectors/test/jira/spec.test.ts`

- [ ] **Step 1: Write the failing test file**

The test exercises the spec's `issues` resource end-to-end across two pages, plus the `projects` resource on one page, with a mocked `fetchImpl`. We assert: chunk counts, cursor watermark advance, JQL since-filter on a resumed sync, and that absolute URLs are built per-tenant.

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createJiraSpec } from '../../src/jira';
import type { ChunkUpsert, ResourceSyncContext } from '@holo/connector-framework';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(fixtureDir, name), 'utf-8'));
}

function makeMockFetch(handlers: Array<(url: string, init: RequestInit) => Promise<Response> | null>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    calls.push({ url, init: init as RequestInit });
    for (const h of handlers) {
      const res = await h(url, init as RequestInit);
      if (res) return res;
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeIssuesCtx(opts: { siteUrl: string; cursor?: { updatedAt?: string } }) {
  const upserts: ChunkUpsert[] = [];
  const flushed: Array<{ updatedAt?: string }> = [];
  const ctx: ResourceSyncContext<{ updatedAt?: string }> = {
    organizationId: 'org-1',
    sourceId: 'src-1',
    tokens: { accessToken: 'Zm9vQGV4YW1wbGUuY29tOnRva2Vu' }, // foo@example.com:token (base64)
    api: {} as ResourceSyncContext<unknown>['api'],
    paginate: {} as ResourceSyncContext<unknown>['paginate'],
    cursor: opts.cursor ?? {},
    allowlist: [],
    sourceMetadata: { siteUrl: opts.siteUrl },
    async upsert(chunk) {
      upserts.push(chunk);
    },
    async flushCursor(c) {
      flushed.push(c);
    },
  };
  return { ctx, upserts, flushed };
}

describe('createJiraSpec', () => {
  it('declares id="jira", apiKey Basic auth, and two resources', () => {
    const spec = createJiraSpec();
    expect(spec.id).toBe('jira');
    expect(spec.displayName).toBe('Jira');
    expect(spec.auth.kind).toBe('apiKey');
    expect(spec.resources.map((r) => r.id).sort()).toEqual(['issues', 'projects']);
  });

  it('issues sync paginates with nextPageToken, emits issue + comment chunks, advances cursor', async () => {
    const page1 = await loadFixture('issues-page-1.json');
    const page2 = await loadFixture('issues-page-2.json');

    const { fetchImpl, calls } = makeMockFetch([
      async (url, init) => {
        if (!url.endsWith('/rest/api/3/search/jql')) return null;
        const body = JSON.parse((init.body as string) ?? '{}');
        return body.nextPageToken
          ? jsonResponse(page2)
          : jsonResponse(page1);
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const { ctx, upserts, flushed } = makeIssuesCtx({ siteUrl: 'https://acme.atlassian.net' });

    const finalCursor = await issuesResource.sync(ctx);

    // Two issues on page 1 (one with a comment) + one issue on page 2 = 3 issues + 1 comment.
    const kinds = upserts.map((u) => u.kind);
    expect(kinds.filter((k) => k === 'jira-issue')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'jira-comment')).toHaveLength(1);

    // Cursor watermark = max(updated) across all issues — page 2's ENG-3 was updated 2026-05-10.
    expect(finalCursor.updatedAt).toBe('2026-05-10T08:00:00.000+0000');
    // Per-page checkpoint: at least one flush after page 1 + one after page 2.
    expect(flushed.length).toBeGreaterThanOrEqual(2);

    // Hits acme.atlassian.net per-tenant URL, not the placeholder.
    expect(calls[0].url.startsWith('https://acme.atlassian.net/')).toBe(true);

    // First request carries Authorization: Basic <token>.
    const authHeader =
      (calls[0].init.headers as Record<string, string>)['Authorization'] ??
      (calls[0].init.headers as Record<string, string>)['authorization'];
    expect(authHeader).toBe('Basic Zm9vQGV4YW1wbGUuY29tOnRva2Vu');
  });

  it('issues sync resumes from cursor.updatedAt with a JQL "updated >=" filter', async () => {
    const { fetchImpl, calls } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/rest/api/3/search/jql')) return null;
        return jsonResponse({ issues: [], isLast: true });
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const { ctx } = makeIssuesCtx({
      siteUrl: 'https://acme.atlassian.net',
      cursor: { updatedAt: '2026-05-09T15:22:00.000+0000' },
    });

    await issuesResource.sync(ctx);
    const body = JSON.parse((calls[0].init.body as string) ?? '{}');
    expect(body.jql).toContain('updated >= "2026-05-09T15:22:00.000+0000"');
    expect(body.jql).toContain('ORDER BY updated ASC');
  });

  it('projects sync emits one chunk per project from a single page', async () => {
    const projects = await loadFixture('projects-page-1.json');
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.includes('/rest/api/3/project/search')) return null;
        return jsonResponse(projects);
      },
    ]);

    const spec = createJiraSpec({ fetchImpl });
    const projectsResource = spec.resources.find((r) => r.id === 'projects')!;
    const upserts: ChunkUpsert[] = [];
    const ctx: ResourceSyncContext<unknown> = {
      organizationId: 'org-1',
      sourceId: 'src-1',
      tokens: { accessToken: 'Zm9vOmJhcg==' },
      api: {} as ResourceSyncContext<unknown>['api'],
      paginate: {} as ResourceSyncContext<unknown>['paginate'],
      cursor: {},
      allowlist: [],
      sourceMetadata: { siteUrl: 'https://acme.atlassian.net' },
      async upsert(chunk) {
        upserts.push(chunk);
      },
      async flushCursor() {},
    };

    await projectsResource.sync(ctx);
    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.kind === 'jira-project')).toBe(true);
    expect(upserts.map((u) => u.metadata.key)).toEqual(['ENG', 'OPS']);
  });

  it('throws HOLO_INVALID_INPUT if sources.metadata.siteUrl is missing', async () => {
    const spec = createJiraSpec({ fetchImpl: async () => jsonResponse({}) });
    const issuesResource = spec.resources.find((r) => r.id === 'issues')!;
    const ctx = {
      organizationId: 'org-1',
      sourceId: 'src-1',
      tokens: { accessToken: 'x' },
      api: {} as ResourceSyncContext<unknown>['api'],
      paginate: {} as ResourceSyncContext<unknown>['paginate'],
      cursor: {},
      allowlist: [],
      sourceMetadata: {},
      async upsert() {},
      async flushCursor() {},
    } as ResourceSyncContext<{ updatedAt?: string }>;

    await expect(issuesResource.sync(ctx)).rejects.toMatchObject({
      code: 'HOLO_INVALID_INPUT',
    });
  });

  it('testConnection issues GET /rest/api/3/myself and returns accountId as externalId', async () => {
    const { fetchImpl } = makeMockFetch([
      async (url) => {
        if (!url.endsWith('/rest/api/3/myself')) return null;
        return jsonResponse({
          accountId: 'u-jane',
          displayName: 'Jane Doe',
          emailAddress: 'jane@acme.test',
        });
      },
    ]);
    const spec = createJiraSpec({ fetchImpl });
    // testConnection's api is constructed by the framework with the real
    // site URL at connect time; we mimic that by passing a stub that
    // proxies to fetchImpl.
    const result = await spec.testConnection({
      tokens: { accessToken: 'x' },
      api: {
        get: async (path: string) =>
          (await (await fetchImpl(`https://probe.atlassian.net${path}`, {})).json()) as unknown,
      } as unknown as ResourceSyncContext<unknown>['api'],
    });
    expect(result.externalId).toBe('u-jane');
    expect(result.name).toBe('Jane Doe');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @holo/connectors test -- test/jira/spec.test.ts`
Expected: FAIL with "Cannot find module '../../src/jira'" (the package isn't built yet).

---

## Task 11: Spec implementation

**Files:**
- Create: `packages/connectors/src/jira/spec.ts`
- Create: `packages/connectors/src/jira/index.ts`

- [ ] **Step 1: Write `spec.ts`**

```ts
import { z } from 'zod';
import { ErrorCode, holoError } from '@holo/errors';
import {
  apiKey,
  createHttpClient,
  defineConnector,
  type ConnectorSpec,
  type HttpConfig,
  type ResourceSyncContext,
  type TestConnectionContext,
  type TestConnectionResult,
} from '@holo/connector-framework';
import { SYNC_INTERVAL_MS_BY_PROVIDER } from '../sync-intervals';
import {
  buildIssuesJql,
  fetchMyself,
  searchIssues,
  searchProjects,
} from './api';
import { processIssue, processProject } from './chunking';

export interface JiraSpecOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

const issuesCursorSchema = z
  .object({
    /** Highest `updated` timestamp we've ingested (Jira ISO with timezone). */
    updatedAt: z.string().optional(),
  })
  .default({});

const projectsCursorSchema = z.object({}).default({});

type IssuesCursor = z.infer<typeof issuesCursorSchema>;
type ProjectsCursor = z.infer<typeof projectsCursorSchema>;

const PLACEHOLDER_BASE_URL = 'https://example.invalid';

const PER_TENANT_HTTP: Omit<HttpConfig, 'baseUrl'> = {
  // Atlassian uses dynamic rate limits + Retry-After on 429. Conservative
  // bucket here; framework absorbs anything the API pushes back on.
  rateLimit: { rps: 5, burst: 20 },
  retry: { maxAttempts: 5, retryOn: [429, 502, 503, 504] },
};

function requireSiteUrl(ctx: ResourceSyncContext<unknown>): string {
  const url = ctx.sourceMetadata['siteUrl'];
  if (typeof url !== 'string' || url.length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Jira source ${ctx.sourceId} has no siteUrl in metadata`,
      fix: 'Reconnect Jira via /connections so the source row is initialised correctly.',
    });
  }
  return url;
}

export function createJiraSpec(opts: JiraSpecOptions = {}): ConnectorSpec {
  const auth = apiKey({ prefix: 'Basic ' });
  const fetchImpl = opts.fetchImpl;

  return defineConnector({
    id: 'jira',
    displayName: 'Jira',

    sync: { intervalMs: SYNC_INTERVAL_MS_BY_PROVIDER.jira },

    auth,

    http: {
      // Placeholder. Every resource constructs its own per-tenant client
      // below — the per-tenant siteUrl lives on sources.metadata and isn't
      // available at spec-construction time.
      baseUrl: PLACEHOLDER_BASE_URL,
      ...PER_TENANT_HTTP,
    },

    async testConnection(ctx: TestConnectionContext): Promise<TestConnectionResult> {
      // The connect route constructs a one-off HttpClient with the real
      // siteUrl and hands it in here; we just ask /myself and turn the
      // user account into a TestConnectionResult. The route's separate
      // serverInfo probe owns capturing cloudId into sources.metadata.
      const me = await fetchMyself(ctx.api);
      return {
        externalId: me.accountId,
        name: me.displayName,
        raw: { accountId: me.accountId, email: me.emailAddress },
      };
    },

    resources: [
      {
        id: 'issues',
        displayName: 'Issues',
        cursorSchema: issuesCursorSchema,
        async sync(ctx: ResourceSyncContext<IssuesCursor>): Promise<IssuesCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          let nextPageToken: string | undefined = undefined;
          let pageNum = 0;
          let highestUpdatedAt = ctx.cursor.updatedAt;
          const jql = buildIssuesJql(ctx.cursor.updatedAt);

          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching issues · page ${pageNum}`,
            });

            const page = await searchIssues(api, { jql, nextPageToken });

            for (const issue of page.issues) {
              ctx.signal?.throwIfAborted();
              await processIssue(ctx, issue, siteUrl);
              const updated = issue.fields.updated;
              if (!highestUpdatedAt || updated > highestUpdatedAt) {
                highestUpdatedAt = updated;
              }
            }

            if (highestUpdatedAt) {
              await ctx.flushCursor({ updatedAt: highestUpdatedAt });
            }

            if (page.isLast || !page.nextPageToken) break;
            nextPageToken = page.nextPageToken;
          }

          return { updatedAt: highestUpdatedAt };
        },
      },
      {
        id: 'projects',
        displayName: 'Projects',
        cursorSchema: projectsCursorSchema,
        async sync(ctx: ResourceSyncContext<ProjectsCursor>): Promise<ProjectsCursor> {
          const siteUrl = requireSiteUrl(ctx);
          const api = createHttpClient({
            config: { ...PER_TENANT_HTTP, baseUrl: siteUrl },
            auth,
            tokens: ctx.tokens,
            fetchImpl,
          });

          let startAt = 0;
          let pageNum = 0;
          while (true) {
            ctx.signal?.throwIfAborted();
            pageNum += 1;
            ctx.reportProgress?.({
              current: pageNum,
              total: null,
              message: `Fetching projects · page ${pageNum}`,
            });

            const page = await searchProjects(api, { startAt });
            for (const project of page.values) {
              ctx.signal?.throwIfAborted();
              await processProject(ctx, project, siteUrl);
            }
            if (page.isLast || page.values.length === 0) break;
            startAt += page.values.length;
          }
          return {};
        },
      },
    ],

    ui: {
      description: 'Issues, inline comments, and project metadata from Jira Cloud.',
      category: 'project',
    },
  });
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
export { createJiraSpec } from './spec';
export type { JiraSpecOptions } from './spec';
export {
  buildIssuesJql,
  fetchMyself,
  fetchServerInfo,
  normalizeSiteUrl,
  searchIssues,
  searchProjects,
} from './api';
export { adfToPlainText } from './adf';
export type {
  JiraIssue,
  JiraIssueSearchResponse,
  JiraMyself,
  JiraProject,
  JiraProjectSearchResponse,
  JiraServerInfo,
} from './types';
```

- [ ] **Step 3: Run the spec test to verify it passes**

Run: `pnpm --filter @holo/connectors test -- test/jira/spec.test.ts`
Expected: PASS, 6 passed.

- [ ] **Step 4: Run the full connectors test suite to confirm nothing regressed**

Run: `pnpm --filter @holo/connectors test`
Expected: PASS for all suites including the new Jira ones.

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/jira/spec.ts packages/connectors/src/jira/index.ts packages/connectors/test/jira/spec.test.ts
git commit -m "feat(connectors/jira): spec with issues + projects resources"
```

---

## Task 12: Export Jira from the connectors barrel

**Files:**
- Modify: `packages/connectors/src/index.ts`

- [ ] **Step 1: Add exports**

Add the following block after the Zendesk export block (around line 153):

```ts
export { createJiraSpec, normalizeSiteUrl as normalizeJiraSiteUrl } from './jira/index';
export type {
  JiraSpecOptions,
  JiraIssue,
  JiraIssueSearchResponse,
  JiraProject,
  JiraProjectSearchResponse,
  JiraMyself,
  JiraServerInfo,
} from './jira/index';
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/connectors typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/connectors/src/index.ts
git commit -m "feat(connectors): export jira from package barrel"
```

---

## Task 13: Worker queue registration

**Files:**
- Modify: `apps/worker/src/queues/types.ts`

- [ ] **Step 1: Add `JIRA_SYNC` to `QUEUE_NAMES` and `QUEUE_CONCURRENCY`**

After the `GOOGLE_CHAT_SYNC` entry in `QUEUE_NAMES`, add:

```ts
  GOOGLE_CHAT_SYNC: 'google-chat-sync',
  JIRA_SYNC: 'jira-sync',
```

And in `QUEUE_CONCURRENCY`, after the `'google-chat-sync': 3` line, add:

```ts
  'google-chat-sync': 3,
  'jira-sync': 2,
```

- [ ] **Step 2: Type-check the worker**

Run: `pnpm --filter @holo/worker typecheck`
Expected: PASS. The compile-time guards (`_RegistrySubsetOfWorker`, `_WorkerSubsetOfRegistry`) verify that every provider in `QUEUE_NAMES_BY_PROVIDER['jira'] = ['jira-sync']` has a matching worker entry, and that the worker has no orphan queues. Forgetting to add `'jira-sync'` to either dict will fail the build here.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/queues/types.ts
git commit -m "feat(worker): register jira-sync queue"
```

---

## Task 14: Register Jira runner in the worker

**Files:**
- Modify: `apps/worker/src/queues/runners.module.ts`

- [ ] **Step 1: Import `createJiraSpec`**

Add `createJiraSpec` to the import list from `@holo/connectors` (around line 22):

```ts
import {
  createLinearSpec,
  createPylonSpec,
  createHubspotSpec,
  createNotionSpec,
  createGrainSpec,
  createSlackSpec,
  createGithubSpec,
  createGitlabSpec,
  createMintlifySpec,
  createZendeskSpec,
  createGoogleDriveSpec,
  createAirtableSpec,
  createGoogleChatSpec,
  createJiraSpec,
  githubAppConfigFromEnv,
} from '@holo/connectors';
```

- [ ] **Step 2: Register the runner**

After the Linear `setSyncRunner` call (around line 155), add:

```ts
    setSyncRunner(QUEUE_NAMES.LINEAR_SYNC, createGenericRunner(createLinearSpec(), deps));
    // Jira: basic-auth (email + API token) collected via the connect-route
    // wizard. Per-tenant siteUrl lives on sources.metadata; the spec builds
    // its own HttpClient per sync.
    setSyncRunner(QUEUE_NAMES.JIRA_SYNC, createGenericRunner(createJiraSpec(), deps));
```

- [ ] **Step 3: Type-check the worker**

Run: `pnpm --filter @holo/worker typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/queues/runners.module.ts
git commit -m "feat(worker): register jira sync runner"
```

---

## Task 15: Widen framework-bridge provider-id casts to include `'jira'`

**Files:**
- Modify: `apps/worker/src/queues/framework-bridge.ts`

The bridge has two hand-rolled provider-id union casts (one in `loadTokens`, one in `saveTokens`) that exist purely for documentation — runtime works either way, but keeping them accurate is the convention.

- [ ] **Step 1: Update both casts**

Replace both occurrences (lines 112 and 159) of:

```ts
providerId as 'github' | 'gitlab' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear' | 'googledrive' | 'google-chat',
```

with:

```ts
providerId as 'github' | 'gitlab' | 'slack' | 'notion' | 'grain' | 'pylon' | 'hubspot' | 'linear' | 'googledrive' | 'google-chat' | 'jira',
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/worker typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/queues/framework-bridge.ts
git commit -m "chore(worker): include jira in framework-bridge provider casts"
```

---

## Task 16: Connect route — failing tests first

**Files:**
- Create: `apps/web/src/app/api/connectors/jira/connect/route.test.ts`

- [ ] **Step 1: Inspect an existing connect-route test to match style**

Run: `ls apps/web/src/app/api/connectors/linear/connect/`
If a `route.test.ts` exists alongside `route.ts`, read it briefly to mirror the in-repo testing harness (request construction, db mock, header mock). If none exists, follow the lighter pattern below — the goal is to exercise the route function directly with a stubbed `getServerContext`.

- [ ] **Step 2: Write the failing test file**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const headersMock = vi.fn(async () => new Headers());
vi.mock('next/headers', () => ({ headers: () => headersMock() }));

const getServerContextMock = vi.fn();
vi.mock('@/lib/server-context', () => ({ getServerContext: () => getServerContextMock() }));

const resolveActiveOrgIdMock = vi.fn(() => 'org-1');
vi.mock('@/lib/active-org', () => ({ resolveActiveOrgId: (s: unknown) => resolveActiveOrgIdMock() }));

const enqueueInitialSyncMock = vi.fn(async () => undefined);
vi.mock('@/lib/sync-queue', () => ({ enqueueInitialSync: () => enqueueInitialSyncMock() }));

const emitAuditEventMock = vi.fn();
vi.mock('@holo/audit', () => ({ emitAuditEvent: (...args: unknown[]) => emitAuditEventMock(...args) }));

import { POST } from './route';

function fakeSession() {
  return { user: { id: 'user-1' } };
}

function makeDb() {
  // Minimal Drizzle-shape stub: chainable select/insert/update with the few
  // methods the route uses. Each terminal returns an empty array or a row.
  const selectChain = {
    from: () => selectChain,
    where: () => Promise.resolve([] as unknown[]),
  };
  const insertChain = {
    values: () => insertChain,
    onConflictDoUpdate: () => Promise.resolve(undefined),
    returning: () => Promise.resolve([{ id: 'cred-1' }]),
  };
  const updateChain = {
    set: () => updateChain,
    where: () => Promise.resolve(undefined),
  };
  return {
    select: () => selectChain,
    insert: () => insertChain,
    update: () => updateChain,
  };
}

function makeAuth() {
  return {
    api: { getSession: vi.fn(async () => fakeSession()) },
  };
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/connectors/jira/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/rest/api/3/myself')) {
      return new Response(
        JSON.stringify({
          accountId: 'u-jane',
          displayName: 'Jane Doe',
          emailAddress: 'jane@acme.test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/rest/api/3/serverInfo')) {
      return new Response(
        JSON.stringify({
          baseUrl: 'https://acme.atlassian.net',
          serverTitle: 'ACME Jira',
          cloudId: 'cloud-abc',
          version: '1.0',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
});

describe('POST /api/connectors/jira/connect', () => {
  it('400s when siteUrl is missing', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    const res = await POST(makeRequest({ email: 'a@b.com', token: 't' }));
    expect(res.status).toBe(400);
  });

  it('400s when siteUrl is not parseable', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    const res = await POST(
      makeRequest({ siteUrl: 'not a url at all', email: 'a@b.com', token: 't' }),
    );
    expect(res.status).toBe(400);
  });

  it('401s when /myself returns 401 (bad token)', async () => {
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db: makeDb() });
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/rest/api/3/myself')) {
        return new Response('Unauthorized', { status: 401 });
      }
      throw new Error('unexpected');
    }) as unknown as typeof fetch;

    const res = await POST(
      makeRequest({
        siteUrl: 'https://acme.atlassian.net',
        email: 'jane@acme.test',
        token: 'bad-token',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    // Bad credentials get mapped to HOLO_INVALID_INPUT via testConnection.
    expect(body.code).toMatch(/HOLO_/);
  });

  it('persists credential + source and enqueues initial sync on success', async () => {
    const db = makeDb();
    const insertSpy = vi.spyOn(db, 'insert');
    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db });
    const res = await POST(
      makeRequest({
        siteUrl: 'https://acme.atlassian.net/',
        email: 'jane@acme.test',
        token: 'jira-api-token',
      }),
    );
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalled();
    expect(enqueueInitialSyncMock).toHaveBeenCalled();
    expect(emitAuditEventMock).toHaveBeenCalled();
  });

  it('normalizes a trailing-slash + pathful siteUrl to host-only https', async () => {
    const db = makeDb();
    const fetchCalls: string[] = [];
    globalThis.fetch = vi.fn(async (url: string) => {
      fetchCalls.push(url);
      if (url.endsWith('/rest/api/3/myself')) {
        return new Response(
          JSON.stringify({ accountId: 'u', displayName: 'D' }),
          { status: 200 },
        );
      }
      if (url.endsWith('/rest/api/3/serverInfo')) {
        return new Response(
          JSON.stringify({ baseUrl: 'https://acme.atlassian.net', cloudId: 'c' }),
          { status: 200 },
        );
      }
      throw new Error('unexpected');
    }) as unknown as typeof fetch;

    getServerContextMock.mockResolvedValue({ auth: makeAuth(), db });
    await POST(
      makeRequest({
        siteUrl: 'HTTPS://Acme.Atlassian.NET/jira/your-work/',
        email: 'a@b.com',
        token: 't',
      }),
    );
    // Every probe hit https://acme.atlassian.net (lowercased, no path, no trailing slash).
    expect(fetchCalls.every((u) => u.startsWith('https://acme.atlassian.net/'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @holo/web test -- src/app/api/connectors/jira/connect/route.test.ts`
Expected: FAIL with "Cannot find module './route'".

---

## Task 17: Connect route implementation

**Files:**
- Create: `apps/web/src/app/api/connectors/jira/connect/route.ts`

- [ ] **Step 1: Write `route.ts`**

```ts
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import { schema } from '@holo/db';
import { holoError, ErrorCode, HoloError } from '@holo/errors';
import {
  createJiraSpec,
  normalizeJiraSiteUrl,
  fetchServerInfo,
} from '@holo/connectors';
import { createHttpClient, apiKey } from '@holo/connector-framework';
import { emitAuditEvent } from '@holo/audit';
import { getServerContext } from '@/lib/server-context';
import { resolveActiveOrgId } from '@/lib/active-org';
import { enqueueInitialSync } from '@/lib/sync-queue';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: `${field} is required`,
      fix: `Provide a non-empty ${field} in the request body.`,
    });
  }
  return value.trim();
}

export async function POST(req: Request) {
  try {
    const { auth, db } = await getServerContext();
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      throw holoError({
        code: ErrorCode.HOLO_AUTH_NO_SESSION,
        problem: 'must be signed in',
        fix: 'Sign in first.',
      });
    }

    const body = (await req.json().catch(() => null)) as
      | { siteUrl?: string; email?: string; token?: string }
      | null;
    if (!body) {
      throw holoError({
        code: ErrorCode.HOLO_ENV_INVALID,
        problem: 'request body must be JSON',
        fix: 'POST { siteUrl, email, token } as JSON.',
      });
    }
    const rawSiteUrl = requireString(body.siteUrl, 'siteUrl');
    const email = requireString(body.email, 'email');
    const token = requireString(body.token, 'token');

    const siteUrl = normalizeJiraSiteUrl(rawSiteUrl);
    // The basic-auth value the framework's apiKey({ prefix: 'Basic ' })
    // strategy will attach as Authorization: Basic <encoded>.
    const encoded = Buffer.from(`${email}:${token}`, 'utf-8').toString('base64');

    const auth_ = apiKey({ prefix: 'Basic ' });
    const probeClient = createHttpClient({
      config: {
        baseUrl: siteUrl,
        retry: { maxAttempts: 3, retryOn: [429, 502, 503, 504] },
      },
      auth: auth_,
      tokens: { accessToken: encoded },
    });

    // Validate credentials by hitting /myself; capture cloudId via serverInfo.
    const spec = createJiraSpec();
    let ident;
    try {
      ident = await spec.testConnection({ api: probeClient, tokens: { accessToken: encoded } });
    } catch (err) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'Jira rejected the credentials',
        fix: 'Check that the email matches the Atlassian account that owns the API token, and that the token is valid (https://id.atlassian.com/manage-profile/security/api-tokens).',
      });
    }
    let serverInfo;
    try {
      serverInfo = await fetchServerInfo(probeClient);
    } catch {
      // serverInfo is optional fallback context — surface only myself errors.
      serverInfo = { baseUrl: siteUrl };
    }

    const orgId = resolveActiveOrgId(session);
    const userId = session.user.id;

    const existing = await db
      .select({ id: schema.connectorCredentials.id })
      .from(schema.connectorCredentials)
      .where(
        and(
          eq(schema.connectorCredentials.organizationId, orgId),
          eq(schema.connectorCredentials.userId, userId),
          eq(
            schema.connectorCredentials.provider,
            'jira' as 'jira',
          ),
        ),
      );
    if (existing[0]) {
      await db
        .update(schema.connectorCredentials)
        .set({
          accessToken: encoded,
          scope: siteUrl,
          status: 'active',
          lastRefreshedAt: new Date(),
        })
        .where(eq(schema.connectorCredentials.id, existing[0].id));
    } else {
      await db.insert(schema.connectorCredentials).values({
        organizationId: orgId,
        userId,
        provider: 'jira',
        accessToken: encoded,
        scope: siteUrl,
        status: 'active',
      });
    }

    const cloudId = serverInfo.cloudId ?? `jira-${new URL(siteUrl).host}`;
    const workspaceName = serverInfo.serverTitle ?? new URL(siteUrl).host;

    await db
      .insert(schema.sources)
      .values({
        organizationId: orgId,
        provider: 'jira',
        externalId: cloudId,
        name: workspaceName,
        metadata: { siteUrl, cloudId, jira_singleton: true },
      })
      .onConflictDoUpdate({
        target: [
          schema.sources.organizationId,
          schema.sources.provider,
          schema.sources.externalId,
        ],
        set: {
          name: workspaceName,
          metadata: { siteUrl, cloudId, jira_singleton: true },
          updatedAt: new Date(),
        },
      });

    await enqueueInitialSync(db, orgId, 'jira').catch(() => {});

    emitAuditEvent({
      db,
      organizationId: orgId,
      userId,
      eventType: 'connector.connected',
      resourceType: 'connector',
      resourceId: 'jira',
      meta: { provider: 'jira', externalId: cloudId, name: workspaceName, siteUrl },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof HoloError) {
      const status =
        e.code === 'HOLO_AUTH_NO_SESSION'
          ? 401
          : e.code === 'HOLO_ENV_INVALID' || e.code === 'HOLO_INVALID_INPUT'
            ? 400
            : 500;
      return NextResponse.json(e.toJSON(), { status });
    }
    console.error(e);
    return NextResponse.json(
      { code: 'HOLO_INTERNAL', problem: 'unexpected error', fix: 'Check server logs.' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Run the route test to verify it passes**

Run: `pnpm --filter @holo/web test -- src/app/api/connectors/jira/connect/route.test.ts`
Expected: PASS, 5 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/connectors/jira/connect/route.ts apps/web/src/app/api/connectors/jira/connect/route.test.ts
git commit -m "feat(web/connectors): add jira connect route"
```

---

## Task 18: Wizard credentials step (3-field form)

**Files:**
- Create: `apps/web/src/components/connection-wizard/steps/jira-credentials-step.tsx`

- [ ] **Step 1: Write the step component**

The component mirrors `api-key-step.tsx` (look at it for the surrounding shell/footer/error conventions) but exposes three inputs: site URL, email, API token (masked + reveal toggle).

```tsx
'use client';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { AlertDialogFooter } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { WizardContext } from '../types';

interface Args {
  helpText?: string;
  helpUrl?: string;
  instructions?: string[];
}

export function jiraCredentialsStep<TState>(
  ctx: WizardContext<TState>,
  args: Args = {},
) {
  return <JiraCredentialsStep ctx={ctx} args={args} />;
}

function JiraCredentialsStep<TState>({
  ctx,
  args,
}: {
  ctx: WizardContext<TState>;
  args: Args;
}) {
  const { meta, connected, forceCredentialEntry } = ctx;
  const showConnectedBanner = connected && !forceCredentialEntry;
  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (siteUrl.trim().length === 0 || email.trim().length === 0 || token.trim().length === 0) {
      setError('Site URL, email, and API token are all required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/connectors/${meta.id}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl, email, token }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        fix?: string;
        problem?: string;
      };
      if (!res.ok) {
        setError(body.fix ?? body.problem ?? 'Connection failed');
        return;
      }
      toast.success(`${meta.displayName} connected`);
      ctx.refreshServer();
      ctx.goNext();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="space-y-4 text-sm">
        {showConnectedBanner ? (
          <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-700 dark:text-emerald-300">
            Jira is connected. Continue to start the first sync.
          </div>
        ) : (
          <>
            {args.instructions && args.instructions.length > 0 ? (
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {args.instructions.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ol>
            ) : null}
            {args.helpText ? (
              <p className="text-muted-foreground">
                {args.helpText}
                {args.helpUrl ? (
                  <>
                    {' '}
                    <a
                      href={args.helpUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Where do I find this?
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}

            <label className="block space-y-1">
              <span className="text-foreground">Site URL</span>
              <input
                type="text"
                placeholder="https://yourcompany.atlassian.net"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                autoComplete="off"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-foreground">Atlassian email</span>
              <input
                type="email"
                placeholder="you@yourcompany.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2"
                autoComplete="off"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-foreground">API token</span>
              <div className="relative">
                <input
                  type={revealed ? 'text' : 'password'}
                  placeholder="Jira API token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setRevealed((r) => !r)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  aria-label={revealed ? 'Hide token' : 'Show token'}
                >
                  {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
                {error}
              </div>
            ) : null}
          </>
        )}
      </div>
      <AlertDialogFooter>
        <Button variant="ghost" onClick={ctx.close} disabled={busy}>
          Cancel
        </Button>
        {showConnectedBanner ? (
          <Button onClick={ctx.goNext}>Continue</Button>
        ) : (
          <Button onClick={save} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect Jira'}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/connection-wizard/steps/jira-credentials-step.tsx
git commit -m "feat(web/connectors): jira three-field credentials step"
```

---

## Task 19: Register Jira in the wizard config registry

**Files:**
- Modify: `apps/web/src/components/connection-wizard/configs.tsx`

- [ ] **Step 1: Import the step**

Add the import alongside the others near the top of the file:

```ts
import { jiraCredentialsStep } from './steps/jira-credentials-step';
```

- [ ] **Step 2: Add `jiraConfig`**

Insert after `const zendeskConfig: ...` and before the `REGISTRY` declaration:

```ts
const jiraConfig: ConnectorWizardConfig = {
  initialState: {},
  steps: [
    {
      id: 'credentials',
      label: 'Connect',
      render: (ctx) =>
        jiraCredentialsStep(ctx, {
          helpText:
            'Holo authenticates via Atlassian basic auth: your email + an API token. Connect from a workspace admin (or service-style user) to mirror the full workspace.',
          helpUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
          instructions: [
            'Open id.atlassian.com/manage-profile/security/api-tokens, click "Create API token", label it "Holo", and copy the value (you can\'t see it again after closing the dialog).',
            'Paste your Jira site URL (e.g. https://yourcompany.atlassian.net), the email of the Atlassian account that owns the token, and the token below.',
            'Holo validates the credentials by calling /rest/api/3/myself before saving.',
          ],
        }),
    },
    { id: 'firstSync', label: 'First sync', render: (ctx) => firstSyncStep(ctx) },
  ],
};
```

- [ ] **Step 3: Add `jira: jiraConfig` to `REGISTRY`**

```ts
const REGISTRY: Partial<Record<ConnectorMeta['id'], ConnectorWizardConfig<any>>> = {
  slack: slackConfig,
  github: githubConfig,
  gitlab: gitlabConfig,
  grain: grainConfig,
  hubspot: hubspotConfig,
  notion: notionConfig,
  pylon: pylonConfig,
  linear: linearConfig,
  mintlify: mintlifyConfig,
  zendesk: zendeskConfig,
  googledrive: googleDriveConfig,
  airtable: airtableConfig,
  'google-chat': googleChatConfig,
  jira: jiraConfig,
};
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @holo/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/connection-wizard/configs.tsx
git commit -m "feat(web/connectors): register jira wizard config"
```

---

## Task 20: Flip the registry entry to `implemented: true`

**Files:**
- Modify: `apps/web/src/lib/connector-registry.ts`

- [ ] **Step 1: Edit the existing `jira` entry**

Change:

```ts
  {
    id: 'jira',
    displayName: 'Jira',
    description: 'Issues, sprints, and project metadata from Jira Cloud.',
    category: 'productivity',
    implemented: false,
    flowType: 'oauth',
  },
```

to:

```ts
  {
    id: 'jira',
    displayName: 'Jira',
    description: 'Issues with inline comments and project metadata from Jira Cloud.',
    category: 'productivity',
    implemented: true,
    flowType: 'apikey',
  },
```

The entry is currently grouped at the bottom with the other `implemented: false` (Coming soon) tiles. Move it up into the implemented block — alphabetical order isn't strictly required (the file orders by build priority), but placing `jira` right after `linear` (line 114) keeps related-category connectors adjacent. Cut the existing `jira` block and paste after `linear` with the new content.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @holo/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/connector-registry.ts
git commit -m "feat(web/connectors): promote jira from coming-soon to implemented"
```

---

## Task 21: Admin setup documentation

**Files:**
- Create: `docs/connectors/jira.md`

- [ ] **Step 1: Write the setup guide**

Skim `docs/connectors/slack.md` and `docs/connectors/linear.md` first to mirror the in-repo doc voice and headings. Then write:

```markdown
# Jira (Cloud)

Holo ingests Jira Cloud issues, top-level comments, and project metadata via Atlassian basic auth (email + API token).

> Only Atlassian-hosted Jira **Cloud** is supported. Jira Server / Data Center are out of scope.

## What gets indexed

- **Issues** — one chunk per issue with key, summary, status, type, priority, assignee, project, labels, and the description (ADF flattened to plain text).
- **Comments** — one chunk per top-level comment (replies in threaded comments are not yet a thing in Jira's data model).
- **Projects** — one chunk per project with name, key, lead, type, and description.

Per-issue and per-comment chunks carry ACL subjects `jira:project:<projectId>` plus `jira:org`, so retrieval can scope to project visibility.

## Recommended setup

Holo authenticates as a single Atlassian user (the API token holder). The token owner sees every issue Holo will index. We recommend:

1. **Create or reuse a workspace-scope service account user** (e.g. `holo@yourcompany.com`) with read-only access to every project you want indexed. This keeps ingestion stable across employee turnover and makes the audit trail clear.
2. From that account, open `https://id.atlassian.com/manage-profile/security/api-tokens`, click **Create API token**, label it `Holo`, and copy the value (Atlassian never shows it again).
3. Note the **site URL** — the host you see in your browser when you visit Jira (e.g. `https://yourcompany.atlassian.net`).

## Connect

In Holo, open `/connections` → **Jira** → **Connect**, then paste:

| Field      | Example                                  |
| ---------- | ---------------------------------------- |
| Site URL   | `https://yourcompany.atlassian.net`      |
| Email      | `holo@yourcompany.com`                   |
| API token  | (the value from step 2 above)            |

Holo validates the credentials by calling `/rest/api/3/myself` and captures your `cloudId` via `/rest/api/3/serverInfo` before saving.

## Rotation

To rotate the API token: revoke the old token in `https://id.atlassian.com/manage-profile/security/api-tokens`, create a new one, then **Reconnect** in Holo (manage sheet → Reconnect) and paste the new token. The site URL and email stay the same.

## Sync cadence

Default: every **4 hours** (matches Linear — issues are high-churn and surfaced in chat-style retrieval). Tunable in `packages/connectors/src/sync-intervals.ts`.

## Limitations (v1)

- No OAuth 2.0 (3LO). Basic auth only.
- Worklogs, attachments, and sprint metadata are not indexed yet.
- Tables, panels, and media inside issue descriptions are rendered as placeholders (`[table]`, `[image: alt]`) — text inside them is dropped.
- One Jira workspace per Holo organization.
```

- [ ] **Step 2: Commit**

```bash
git add docs/connectors/jira.md
git commit -m "docs(connectors): add jira setup guide"
```

---

## Task 22: Final verification

**Files:**
- (no edits)

- [ ] **Step 1: Type-check the whole monorepo**

Run: `pnpm -w typecheck`
Expected: PASS. If any package fails, fix in place — the most likely culprits are: a missing entry in `SYNC_PROVIDERS` widening (Task 1), the framework-bridge cast (Task 15), or a stale Drizzle generated type (re-run `pnpm db:generate` if so).

- [ ] **Step 2: Run all tests**

Run: `pnpm -w test`
Expected: PASS. New suites: `packages/connectors/test/jira/adf.test.ts`, `chunking.test.ts`, `spec.test.ts`; `apps/web/src/app/api/connectors/jira/connect/route.test.ts`.

- [ ] **Step 3: Lint**

Run: `pnpm -w lint`
Expected: PASS. If ESLint flags the framework-bridge `as` cast or the unused `cloudId` fallback, address inline.

- [ ] **Step 4: Run the migration meta check**

Run: `pnpm db:check`
Expected: PASS. We added no migration this PR, so the journal/snapshot relationship is unchanged — this just confirms we didn't accidentally regenerate any meta files.

- [ ] **Step 5: Manual smoke (dev environment)**

Bring up the dev stack:

```bash
docker compose up -d postgres redis
pnpm dev
```

Then:

1. Open `http://localhost:3000/connections`. The Jira tile should now show **Connect** (not "Coming soon").
2. Click **Connect**. The wizard's first step should ask for site URL, email, and API token (not a generic single-field token paste).
3. Paste a real (test-account) Jira site URL + email + token. Verify the wizard advances to **First sync** and the connection tile flips to **Manage** within a few seconds.
4. Watch the worker logs: `pnpm --filter @holo/worker dev` — expect lines indicating `jira-sync` job processed and N issue + comment chunks emitted.
5. Hit `/api/connectors/status` and confirm the response includes `jira` (this asserts the registry-wide `SYNC_PROVIDERS` import is now picking up the new provider end-to-end).

If any step fails, capture the error and address before moving to PR.

- [ ] **Step 6: Commit any final tidy**

If steps 1–5 surfaced a fix, commit it:

```bash
git add -p
git commit -m "fix(connectors/jira): <specific issue surfaced in smoke>"
```

If everything passed cleanly with no changes, skip this step.

---

## Self-Review

Spec coverage — every section maps to at least one task:

- **Auth (basic auth)**: Tasks 11 (spec uses `apiKey({ prefix: 'Basic ' })`), 17 (connect route base64-encodes `email:token`), 18 (wizard collects 3 fields).
- **Per-tenant base URL**: Tasks 11 (placeholder + per-resource `createHttpClient`), 17 (connect-route probe client with real site URL), 7 (`normalizeSiteUrl`).
- **Resources (issues + projects)**: Tasks 11 (spec), 8/9 (chunking), 10 (spec test).
- **ADF rendering**: Tasks 3/4.
- **ACL subjects**: Task 9 (`processIssue`, `processProject`); covered by Task 8 tests.
- **Chunking shape**: Task 9; covered by Task 8 tests.
- **Sync cadence**: Task 2.
- **HTTP rate-limit / retry**: Task 11 (spec `PER_TENANT_HTTP`).
- **Worker queue + runner**: Tasks 13–15.
- **Wizard**: Tasks 18–20.
- **Connect route + cloudId**: Tasks 16–17.
- **Database**: No-op; documented in File Structure.
- **Docs**: Task 21.
- **Verification**: Task 22.

No placeholders or TBDs. Function/type names cross-checked: `processIssue`, `processProject`, `adfToPlainText`, `createJiraSpec`, `normalizeSiteUrl` / `normalizeJiraSiteUrl` (the barrel re-exports under the Jira-prefixed name to avoid collisions with future per-connector normalizers), `buildIssuesJql`, `searchIssues`, `searchProjects`, `fetchMyself`, `fetchServerInfo` — all consistent between tasks.

The only intentional "TBD-ish" string is the `0XXX` migration index referenced in the design doc, which **no longer applies** — the plan determined no migration is needed and explicitly omits the task.
