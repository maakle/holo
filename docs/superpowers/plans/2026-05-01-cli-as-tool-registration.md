# CLI-as-tool registration — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `holo tool register` so an org admin can expose a scoped CLI invocation (`bq query`, `psql`, `aws s3 ls`, etc.) as a per-org MCP tool, gated by the existing per-skill `tool_allowlist`.

**Architecture:** New `custom_tools` Postgres table + new `@holo/custom-tools` package containing pure expander/validator/runner functions and a thin DB repository. `apps/mcp` reads custom tools per request, merges them with built-ins in `tools/list`, and dispatches `tools/call` through a spawn runner that does argv-only execution with a hard timeout, output cap, and audit-log entry. CLI commands live under `holo tool …`.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres, Hono, Ajv (new dep), Commander, Vitest. Spec: `docs/superpowers/specs/2026-05-01-cli-as-tool-registration-design.md`.

**Reference points in existing v0.2 code:**
- `apps/mcp/src/tools/index.ts` — built-in tool registry (must become ctx-aware)
- `apps/mcp/src/jsonrpc.ts` — `tools/list` + `tools/call` dispatch (two `listTools()` call sites)
- `apps/mcp/src/middleware/allowlist.ts` — `checkToolAllowed`, must learn about custom tools
- `apps/mcp/test/allowlist.test.ts` — existing pattern to extend
- `packages/db/src/schema/holo.ts` — `skills` table at lines 202–235, `auditEvents` at lines for shape reference
- `packages/db/test/schema-presence.test.ts` — REQUIRED_TABLES list to extend
- `packages/db/test/skills-schema.test.ts` — column-list test to mirror
- `packages/db/migrations/` — last migration is `0016_oauth_clients`; new one is `0017_custom_tools.sql`
- `packages/audit/src/index.ts` — `AuditEventType` union to extend
- `packages/cli/src/commands/allowlist.ts` — Commander pattern to mirror
- `eslint.config.mjs` — `apps/mcp/src/**` may not import `packages/db/src/**` directly; new `@holo/custom-tools` package is the indirection

---

## File structure

**Created:**
- `packages/custom-tools/package.json`
- `packages/custom-tools/tsconfig.json`
- `packages/custom-tools/src/index.ts` — public exports
- `packages/custom-tools/src/types.ts` — `CustomToolRow`, `ExpandedInvocation`, `RunResult`
- `packages/custom-tools/src/expand-args.ts` — argv template expander (pure)
- `packages/custom-tools/src/validate-input.ts` — Ajv-backed input validator
- `packages/custom-tools/src/spawn-runner.ts` — `child_process.spawn` with timeout + output cap
- `packages/custom-tools/src/repository.ts` — Drizzle queries (list/get/create/delete)
- `packages/custom-tools/src/mcp-tool-factory.ts` — build a `ToolDefinition`-shaped object from a row
- `packages/custom-tools/src/audit.ts` — narrow audit emit wrapper for custom-tool invocations
- `packages/custom-tools/test/expand-args.test.ts`
- `packages/custom-tools/test/validate-input.test.ts`
- `packages/custom-tools/test/spawn-runner.test.ts`
- `packages/custom-tools/test/fixtures/echo-tool.sh` — argv+env echo binary
- `packages/db/migrations/0017_custom_tools.sql`
- `packages/db/test/custom-tools-schema.test.ts`
- `packages/cli/src/commands/tool.ts` — Commander group registration
- `packages/cli/src/commands/tool-register.ts`
- `packages/cli/src/commands/tool-list.ts`
- `packages/cli/src/commands/tool-show.ts`
- `packages/cli/src/commands/tool-unregister.ts`
- `apps/mcp/test/custom-tools-roundtrip.test.ts`

**Modified:**
- `packages/db/src/schema/holo.ts` — add `customTools` Drizzle table
- `packages/db/migrations/meta/_journal.json` — append entry for `0017_custom_tools`
- `packages/db/test/schema-presence.test.ts` — add `'custom_tools'` to `REQUIRED_TABLES`
- `packages/audit/src/index.ts` — add `'custom_tool.invoked'` to `AuditEventType`
- `apps/mcp/src/tools/index.ts` — `listTools()` becomes `listTools(ctx)` returning Promise
- `apps/mcp/src/jsonrpc.ts` — both `listTools()` call sites pass ctx, await
- `apps/mcp/src/middleware/allowlist.ts` — `checkToolAllowed` accepts custom-tool name set
- `apps/mcp/test/allowlist.test.ts` — extend with custom-tool cases
- `packages/cli/src/main.ts` — register the new `tool` command group
- `pnpm-workspace.yaml` — N/A (uses `packages/*` glob already; new package is auto-included)
- `package.json` (root) — N/A
- `packages/custom-tools/package.json` — depends on `ajv`, `@holo/db`, `@holo/errors`, `@holo/audit`
- `docs/ROADMAP.md` — tick the v0.2 CLI-as-tool checkbox

**Why a new package, not a `retrieval-core` module:** the ESLint `import-x/no-restricted-paths` rule blocks `apps/mcp/src/**` from importing `packages/db/src/**`. A new package consuming `@holo/db` is the clean boundary; "retrieval-core" is the wrong name for spawn/exec.

---

## Conventions used throughout

- TDD per task: write the failing test, run it, write the minimal implementation, run it, commit.
- Tests use Vitest. Schema tests run against a live Postgres at `DATABASE_URL` (default `postgresql://holo:holo@localhost:5436/holo`); they assume migrations have been applied via `pnpm --filter @holo/db migrate`.
- Errors use `holoError({ code: ErrorCode.X, problem, fix })` from `@holo/errors`. Add new codes to `packages/errors/src/codes.ts` as needed.
- Commits: small, conventional-commit-style messages, one per task unless noted.

---

## Task 1: Drizzle schema + migration for `custom_tools`

**Files:**
- Modify: `packages/db/src/schema/holo.ts` — append `customTools` table after `oauthClients`
- Create: `packages/db/migrations/0017_custom_tools.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/test/schema-presence.test.ts` — add `'custom_tools'` to `REQUIRED_TABLES`
- Create: `packages/db/test/custom-tools-schema.test.ts`

- [ ] **Step 1: Write the failing column-list test**

`packages/db/test/custom-tools-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
  sql = postgres(url, { max: 1 });
});
afterAll(async () => {
  await sql.end();
});

describe('custom_tools schema', () => {
  it('table exists with all required columns', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'custom_tools'
       ORDER BY column_name
    `;
    const names = rows.map((r) => r.column_name).sort();
    expect(names).toEqual(
      [
        'args_template',
        'command',
        'created_at',
        'created_by',
        'description',
        'env_allowlist',
        'id',
        'input_schema',
        'max_output_bytes',
        'name',
        'organization_id',
        'read_only',
        'scope',
        'timeout_ms',
      ].sort(),
    );
  });

  it('has unique (organization_id, name) index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'custom_tools'
    `;
    expect(rows.map((r) => r.indexname)).toContain('custom_tools_org_name_uniq');
  });
});
```

- [ ] **Step 2: Add `'custom_tools'` to `REQUIRED_TABLES`**

In `packages/db/test/schema-presence.test.ts`, append `'custom_tools'` to the `REQUIRED_TABLES` array (alphabetical order is not enforced; place near `'connector_allowlists'`).

- [ ] **Step 3: Run schema tests to confirm they fail**

```bash
pnpm --filter @holo/db test -- custom-tools-schema schema-presence
```

Expected: both fail with "table custom_tools does not exist".

- [ ] **Step 4: Add `customTools` Drizzle table**

Append to `packages/db/src/schema/holo.ts` (after `oauthClients`, before any closing exports):

```ts
export const customTools = pgTable(
  'custom_tools',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organization.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    command: text('command').notNull(),
    argsTemplate: text('args_template').array().notNull().default(sql`'{}'::text[]`),
    inputSchema: jsonb('input_schema').$type<Record<string, unknown>>().notNull(),
    envAllowlist: text('env_allowlist').array().notNull().default(sql`'{}'::text[]`),
    scope: text('scope'),
    readOnly: boolean('read_only').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull().default(30000),
    maxOutputBytes: integer('max_output_bytes').notNull().default(262144),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => user.id),
  },
  (t) => ({
    orgNameUniq: uniqueIndex('custom_tools_org_name_uniq').on(t.organizationId, t.name),
    orgIdx: index('custom_tools_org_idx').on(t.organizationId),
  }),
);
```

If `boolean`, `jsonb`, `integer` aren't already imported at the top of the file, add them to the existing `drizzle-orm/pg-core` import.

- [ ] **Step 5: Write the migration SQL**

`packages/db/migrations/0017_custom_tools.sql`:

```sql
CREATE TABLE IF NOT EXISTS "custom_tools" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id"),
  "name" text NOT NULL,
  "description" text NOT NULL,
  "command" text NOT NULL,
  "args_template" text[] NOT NULL DEFAULT '{}'::text[],
  "input_schema" jsonb NOT NULL,
  "env_allowlist" text[] NOT NULL DEFAULT '{}'::text[],
  "scope" text,
  "read_only" boolean NOT NULL DEFAULT false,
  "timeout_ms" integer NOT NULL DEFAULT 30000,
  "max_output_bytes" integer NOT NULL DEFAULT 262144,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid NOT NULL REFERENCES "user"("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_tools_org_name_uniq"
  ON "custom_tools" ("organization_id", "name");

CREATE INDEX IF NOT EXISTS "custom_tools_org_idx"
  ON "custom_tools" ("organization_id");
```

- [ ] **Step 6: Append journal entry**

In `packages/db/migrations/meta/_journal.json`, append to `entries` (after the existing `0016_oauth_clients` entry; bump `idx` to 17, set `tag` to `"0017_custom_tools"`, copy the prior entry's `version` and `breakpoints`, and use a `when` value greater than the previous entry — `Date.now()` at the time of edit is fine).

- [ ] **Step 7: Apply migration and run tests**

```bash
pnpm --filter @holo/db migrate
pnpm --filter @holo/db test
```

Expected: both new tests pass; existing schema tests still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/schema/holo.ts \
        packages/db/migrations/0017_custom_tools.sql \
        packages/db/migrations/meta/_journal.json \
        packages/db/test/schema-presence.test.ts \
        packages/db/test/custom-tools-schema.test.ts
git commit -m "feat(db): custom_tools table for CLI-as-tool registration"
```

---

## Task 2: `@holo/custom-tools` package skeleton

**Files:**
- Create: `packages/custom-tools/package.json`
- Create: `packages/custom-tools/tsconfig.json`
- Create: `packages/custom-tools/src/index.ts`
- Create: `packages/custom-tools/src/types.ts`

- [ ] **Step 1: Create package.json**

`packages/custom-tools/package.json`:

```json
{
  "name": "@holo/custom-tools",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "lint": "eslint src",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "ajv": "8.17.1",
    "@holo/db": "workspace:*",
    "@holo/errors": "workspace:*",
    "@holo/audit": "workspace:*",
    "drizzle-orm": "0.36.0"
  },
  "devDependencies": {
    "vitest": "2.1.4",
    "typescript": "5.6.3"
  }
}
```

(Match the exact `vitest`/`typescript` versions used elsewhere in the repo — check `packages/db/package.json` and copy.)

- [ ] **Step 2: Create tsconfig.json**

`packages/custom-tools/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*", "test/**/*"]
}
```

(If the repo uses a different shared tsconfig path, mirror what `packages/audit/tsconfig.json` uses.)

- [ ] **Step 3: Create types.ts**

`packages/custom-tools/src/types.ts`:

```ts
export interface CustomToolRow {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  command: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ExpandedInvocation {
  command: string;
  argv: string[];
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  durationMs: number;
}
```

- [ ] **Step 4: Create empty index.ts**

`packages/custom-tools/src/index.ts`:

```ts
export type { CustomToolRow, ExpandedInvocation, RunResult } from './types.js';
```

- [ ] **Step 5: Install + typecheck**

```bash
pnpm install
pnpm --filter @holo/custom-tools typecheck
```

Expected: install succeeds, typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add packages/custom-tools/ pnpm-lock.yaml
git commit -m "chore(custom-tools): package skeleton"
```

---

## Task 3: argv template expander

**Files:**
- Create: `packages/custom-tools/test/expand-args.test.ts`
- Create: `packages/custom-tools/src/expand-args.ts`
- Modify: `packages/custom-tools/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/custom-tools/test/expand-args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { expandArgs } from '../src/expand-args.js';

describe('expandArgs', () => {
  it('substitutes a single placeholder', () => {
    expect(expandArgs(['query', '{{sql}}'], { sql: 'SELECT 1' }))
      .toEqual(['query', 'SELECT 1']);
  });

  it('substitutes multiple placeholders, preserving order', () => {
    expect(
      expandArgs(['--from', '{{a}}', '--to', '{{b}}'], { a: 'x', b: 'y' }),
    ).toEqual(['--from', 'x', '--to', 'y']);
  });

  it('preserves literal {{ via {{{{ escape', () => {
    expect(expandArgs(['echo', '{{{{literal}}}}'], {})).toEqual(['echo', '{{literal}}']);
  });

  it('throws on missing placeholder value', () => {
    expect(() => expandArgs(['{{missing}}'], {})).toThrow(/missing/i);
  });

  it('passes shell metacharacters through as literal argv', () => {
    expect(expandArgs(['{{x}}'], { x: '$(rm -rf /); echo hi' }))
      .toEqual(['$(rm -rf /); echo hi']);
  });

  it('stringifies non-string values (numbers, booleans)', () => {
    expect(expandArgs(['{{n}}', '{{b}}'], { n: 42, b: true }))
      .toEqual(['42', 'true']);
  });

  it('rejects nested or partial placeholders cleanly', () => {
    // A bare `{{` with no closing `}}` is invalid.
    expect(() => expandArgs(['{{unclosed'], { unclosed: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
pnpm --filter @holo/custom-tools test -- expand-args
```

Expected: fails with "expandArgs is not a function".

- [ ] **Step 3: Implement `expandArgs`**

`packages/custom-tools/src/expand-args.ts`:

```ts
import { holoError, ErrorCode } from '@holo/errors';

const PLACEHOLDER = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;
const ESCAPED_OPEN = ' ESCOPEN ';
const ESCAPED_CLOSE = ' ESCCLOSE ';

export function expandArgs(
  template: readonly string[],
  values: Readonly<Record<string, unknown>>,
): string[] {
  return template.map((part) => {
    // Handle the {{{{ ... }}}} literal escape: temporarily replace the doubled
    // braces with sentinels so the placeholder regex doesn't match them.
    const protectedPart = part.replace(/\{\{\{\{/g, ESCAPED_OPEN).replace(/\}\}\}\}/g, ESCAPED_CLOSE);

    // Detect any remaining unbalanced `{{` or `}}` after placeholders.
    const expanded = protectedPart.replace(PLACEHOLDER, (_match, name: string) => {
      if (!(name in values)) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `Template placeholder {{${name}}} has no provided value`,
          fix: `Pass a value for "${name}" in the tool call arguments.`,
        });
      }
      return String(values[name]);
    });

    if (expanded.includes('{{') || expanded.includes('}}')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Malformed template fragment: ${part}`,
        fix: 'Use {{name}} for placeholders or {{{{ }}}} for literal braces.',
      });
    }

    return expanded.replace(new RegExp(ESCAPED_OPEN, 'g'), '{{').replace(new RegExp(ESCAPED_CLOSE, 'g'), '}}');
  });
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @holo/custom-tools test -- expand-args
```

Expected: all tests pass.

- [ ] **Step 5: Re-export from index.ts**

Add to `packages/custom-tools/src/index.ts`:

```ts
export { expandArgs } from './expand-args.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/custom-tools/src/expand-args.ts \
        packages/custom-tools/src/index.ts \
        packages/custom-tools/test/expand-args.test.ts
git commit -m "feat(custom-tools): argv template expander"
```

---

## Task 4: input validator (Ajv strict)

**Files:**
- Create: `packages/custom-tools/test/validate-input.test.ts`
- Create: `packages/custom-tools/src/validate-input.ts`
- Modify: `packages/custom-tools/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/custom-tools/test/validate-input.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateInput } from '../src/validate-input.js';

const schema = {
  type: 'object',
  properties: {
    sql: { type: 'string', minLength: 1 },
  },
  required: ['sql'],
  additionalProperties: false,
} as const;

describe('validateInput', () => {
  it('returns parsed args when valid', () => {
    expect(validateInput(schema, { sql: 'SELECT 1' })).toEqual({ sql: 'SELECT 1' });
  });

  it('throws structured error on missing required prop', () => {
    expect(() => validateInput(schema, {})).toThrow(/sql/);
  });

  it('throws on additional properties (strict)', () => {
    expect(() => validateInput(schema, { sql: 'x', extra: 1 })).toThrow();
  });

  it('throws on type mismatch', () => {
    expect(() => validateInput(schema, { sql: 42 })).toThrow();
  });

  it('rejects non-object inputs', () => {
    expect(() => validateInput(schema, null)).toThrow();
    expect(() => validateInput(schema, 'string')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
pnpm --filter @holo/custom-tools test -- validate-input
```

- [ ] **Step 3: Implement `validateInput`**

`packages/custom-tools/src/validate-input.ts`:

```ts
import Ajv, { type ErrorObject } from 'ajv';
import { holoError, ErrorCode } from '@holo/errors';

const ajv = new Ajv({ strict: true, allErrors: true, allowUnionTypes: false });

export function validateInput(
  schema: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> {
  const validate = ajv.compile(schema);
  if (!validate(input)) {
    const errs = (validate.errors ?? []).map(formatErr).join('; ');
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Tool input failed schema validation: ${errs}`,
      fix: 'Check the tool inputSchema and adjust the arguments.',
    });
  }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Tool input must be a JSON object',
      fix: 'Pass an object, not null/array/scalar.',
    });
  }
  return input as Record<string, unknown>;
}

function formatErr(e: ErrorObject): string {
  return `${e.instancePath || '/'} ${e.message ?? 'invalid'}`.trim();
}
```

- [ ] **Step 4: Run tests, confirm pass**

```bash
pnpm --filter @holo/custom-tools test -- validate-input
```

- [ ] **Step 5: Re-export**

Add to `packages/custom-tools/src/index.ts`:

```ts
export { validateInput } from './validate-input.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/custom-tools/src/validate-input.ts \
        packages/custom-tools/src/index.ts \
        packages/custom-tools/test/validate-input.test.ts
git commit -m "feat(custom-tools): Ajv-backed input validator"
```

---

## Task 5: spawn runner (timeout + output cap)

**Files:**
- Create: `packages/custom-tools/test/fixtures/echo-tool.sh`
- Create: `packages/custom-tools/test/spawn-runner.test.ts`
- Create: `packages/custom-tools/src/spawn-runner.ts`
- Modify: `packages/custom-tools/src/index.ts`

- [ ] **Step 1: Create fixture binary**

`packages/custom-tools/test/fixtures/echo-tool.sh`:

```sh
#!/bin/sh
# Usage: echo-tool.sh [argv...]
# Prints each argv on its own line, then a separator, then selected env vars.
for a in "$@"; do
  printf '%s\n' "$a"
done
printf -- '---ENV---\n'
printf 'CUSTOM_TOOLS_TEST_FOO=%s\n' "${CUSTOM_TOOLS_TEST_FOO-}"
printf 'CUSTOM_TOOLS_TEST_BAR=%s\n' "${CUSTOM_TOOLS_TEST_BAR-}"
```

Then `chmod +x packages/custom-tools/test/fixtures/echo-tool.sh`.

- [ ] **Step 2: Write failing tests**

`packages/custom-tools/test/spawn-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCommand } from '../src/spawn-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const ECHO = resolve(here, 'fixtures/echo-tool.sh');

describe('runCommand', () => {
  it('runs argv-only and returns stdout/exit', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: ['hello', 'world'],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.split('\n')).toContain('hello');
    expect(r.stdout.split('\n')).toContain('world');
    expect(r.truncated).toBe(false);
  });

  it('passes only env-allowlisted vars', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: [],
      env: { CUSTOM_TOOLS_TEST_FOO: 'yes', CUSTOM_TOOLS_TEST_BAR: 'also' },
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_FOO=yes');
    expect(r.stdout).toContain('CUSTOM_TOOLS_TEST_BAR=also');
  });

  it('does NOT shell-interpret argv (security control)', async () => {
    const r = await runCommand({
      command: ECHO,
      argv: ['$(echo PWNED)', '`echo PWNED`', '; echo PWNED'],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('PWNED\n'); // PWNED only appears as a literal arg
    expect(r.stdout).toContain('$(echo PWNED)');
  });

  it('caps stdout at maxOutputBytes and flags truncated', async () => {
    // Use `yes` (POSIX), which prints "y\n" forever.
    const r = await runCommand({
      command: '/usr/bin/yes',
      argv: [],
      env: {},
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    });
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(1024);
  });

  it('kills child on timeout and returns truncated/error result', async () => {
    const r = await runCommand({
      command: '/bin/sh',
      argv: ['-c', 'sleep 5'],
      env: {},
      timeoutMs: 200,
      maxOutputBytes: 65536,
    });
    expect(r.exitCode).not.toBe(0); // timed out
    expect(r.durationMs).toBeLessThan(2000);
  });
});
```

- [ ] **Step 3: Run tests, confirm failure**

```bash
pnpm --filter @holo/custom-tools test -- spawn-runner
```

- [ ] **Step 4: Implement `runCommand`**

`packages/custom-tools/src/spawn-runner.ts`:

```ts
import { spawn } from 'node:child_process';
import type { RunResult } from './types.js';

export interface RunCommandInput {
  command: string;
  argv: string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export function runCommand(input: RunCommandInput): Promise<RunResult> {
  const { command, argv, env, timeoutMs, maxOutputBytes } = input;
  return new Promise((resolveP) => {
    const start = Date.now();
    const child = spawn(command, argv, {
      env: { ...env, PATH: process.env.PATH ?? '' }, // PATH is needed to resolve binaries
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let truncated = false;
    let killed = false;

    const cap = (which: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const current = which === 'stdout' ? stdout : stderr;
      if (current.length >= maxOutputBytes) {
        if (!killed) {
          killed = true;
          truncated = true;
          child.kill('SIGTERM');
        }
        return;
      }
      const room = maxOutputBytes - current.length;
      const slice = chunk.toString('utf8').slice(0, room);
      if (which === 'stdout') stdout += slice;
      else stderr += slice;
      if (slice.length < chunk.length) {
        truncated = true;
        if (!killed) {
          killed = true;
          child.kill('SIGTERM');
        }
      }
    };

    child.stdout.on('data', cap('stdout'));
    child.stderr.on('data', cap('stderr'));

    const timer = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill('SIGKILL');
      }
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolveP({
        stdout,
        stderr: stderr + `\n[spawn error] ${err.message}`,
        exitCode: -1,
        truncated,
        durationMs: Date.now() - start,
      });
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveP({
        stdout,
        stderr,
        exitCode: code ?? (signal ? -1 : 0),
        truncated,
        durationMs: Date.now() - start,
      });
    });
  });
}
```

- [ ] **Step 5: Run tests, confirm pass**

```bash
pnpm --filter @holo/custom-tools test -- spawn-runner
```

If `/usr/bin/yes` is not present on the dev machine, swap to `/bin/sh -c "while true; do echo y; done"`.

- [ ] **Step 6: Re-export**

Add to `packages/custom-tools/src/index.ts`:

```ts
export { runCommand } from './spawn-runner.js';
export type { RunCommandInput } from './spawn-runner.js';
```

- [ ] **Step 7: Commit**

```bash
git add packages/custom-tools/src/spawn-runner.ts \
        packages/custom-tools/src/index.ts \
        packages/custom-tools/test/spawn-runner.test.ts \
        packages/custom-tools/test/fixtures/echo-tool.sh
git commit -m "feat(custom-tools): argv-only spawn runner with timeout + output cap"
```

---

## Task 6: repository (DB queries)

**Files:**
- Create: `packages/custom-tools/src/repository.ts`
- Modify: `packages/custom-tools/src/index.ts`

No test file in this task — repository functions are thin SQL covered by Tasks 11–13 integration tests. Keeps the focus on behavior, not Drizzle ergonomics.

- [ ] **Step 1: Implement repository**

`packages/custom-tools/src/repository.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { holoError, ErrorCode } from '@holo/errors';
import type { CustomToolRow } from './types.js';

export async function listCustomTools(
  db: DB,
  organizationId: string,
): Promise<CustomToolRow[]> {
  const rows = await db
    .select()
    .from(schema.customTools)
    .where(eq(schema.customTools.organizationId, organizationId));
  return rows.map(toRow);
}

export async function getCustomToolByName(
  db: DB,
  organizationId: string,
  name: string,
): Promise<CustomToolRow | null> {
  const rows = await db
    .select()
    .from(schema.customTools)
    .where(
      and(
        eq(schema.customTools.organizationId, organizationId),
        eq(schema.customTools.name, name),
      ),
    )
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
}

export interface CreateCustomToolInput {
  organizationId: string;
  createdBy: string;
  name: string;
  description: string;
  command: string;
  argsTemplate: string[];
  inputSchema: Record<string, unknown>;
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export async function createCustomTool(db: DB, input: CreateCustomToolInput): Promise<string> {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(input.name)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Custom tool name '${input.name}' is invalid`,
      fix: 'Use 3-64 chars, lowercase letters/digits/underscore, starting with a letter.',
    });
  }
  if (input.timeoutMs > 60000) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `timeout_ms ${input.timeoutMs} exceeds hard ceiling 60000`,
      fix: 'Set --timeout-ms to 60000 or less.',
    });
  }
  if (input.maxOutputBytes > 1_048_576) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `max_output_bytes ${input.maxOutputBytes} exceeds hard ceiling 1048576`,
      fix: 'Set --max-output-bytes to 1048576 or less.',
    });
  }
  const [row] = await db
    .insert(schema.customTools)
    .values({
      organizationId: input.organizationId,
      createdBy: input.createdBy,
      name: input.name,
      description: input.description,
      command: input.command,
      argsTemplate: input.argsTemplate,
      inputSchema: input.inputSchema,
      envAllowlist: input.envAllowlist,
      scope: input.scope,
      readOnly: input.readOnly,
      timeoutMs: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
    })
    .returning({ id: schema.customTools.id });
  return row!.id;
}

export async function deleteCustomToolByName(
  db: DB,
  organizationId: string,
  name: string,
): Promise<boolean> {
  const result = await db
    .delete(schema.customTools)
    .where(
      and(
        eq(schema.customTools.organizationId, organizationId),
        eq(schema.customTools.name, name),
      ),
    )
    .returning({ id: schema.customTools.id });
  return result.length > 0;
}

function toRow(r: typeof schema.customTools.$inferSelect): CustomToolRow {
  return {
    id: r.id,
    organizationId: r.organizationId,
    name: r.name,
    description: r.description,
    command: r.command,
    argsTemplate: r.argsTemplate,
    inputSchema: r.inputSchema as Record<string, unknown>,
    envAllowlist: r.envAllowlist,
    scope: r.scope,
    readOnly: r.readOnly,
    timeoutMs: r.timeoutMs,
    maxOutputBytes: r.maxOutputBytes,
  };
}
```

- [ ] **Step 2: Re-export and typecheck**

Add to `packages/custom-tools/src/index.ts`:

```ts
export {
  listCustomTools,
  getCustomToolByName,
  createCustomTool,
  deleteCustomToolByName,
} from './repository.js';
export type { CreateCustomToolInput } from './repository.js';
```

```bash
pnpm --filter @holo/custom-tools typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/custom-tools/src/repository.ts packages/custom-tools/src/index.ts
git commit -m "feat(custom-tools): repository (list/get/create/delete)"
```

---

## Task 7: extend `AuditEventType` + emit helper

**Files:**
- Modify: `packages/audit/src/index.ts`
- Create: `packages/custom-tools/src/audit.ts`
- Modify: `packages/custom-tools/src/index.ts`

- [ ] **Step 1: Add event type to the union**

In `packages/audit/src/index.ts`, extend `AuditEventType`:

```ts
export type AuditEventType =
  | 'skill_run.started'
  | 'skill_run.completed'
  | 'skill_run.failed'
  | 'api_token.created'
  | 'api_token.revoked'
  | 'skill.published'
  | 'skill.synthesized'
  | 'member.invited'
  | 'custom_tool.invoked';
```

- [ ] **Step 2: Wrapper for the custom-tools package**

`packages/custom-tools/src/audit.ts`:

```ts
import type { DB } from '@holo/db';
import { emitAuditEvent } from '@holo/audit';
import type { RunResult, CustomToolRow } from './types.js';

export interface EmitInvocationInput {
  db: DB;
  tool: CustomToolRow;
  args: Record<string, unknown>;
  userId?: string;
  result: RunResult;
}

export function emitCustomToolInvocation(input: EmitInvocationInput): void {
  const { db, tool, args, userId, result } = input;
  emitAuditEvent({
    db,
    organizationId: tool.organizationId,
    userId,
    eventType: 'custom_tool.invoked',
    resourceType: 'custom_tool',
    resourceId: tool.id,
    meta: {
      tool_name: tool.name,
      args,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      truncated: result.truncated,
      scope: tool.scope,
      read_only: tool.readOnly,
    },
  });
}
```

- [ ] **Step 3: Re-export and typecheck**

```ts
// packages/custom-tools/src/index.ts
export { emitCustomToolInvocation } from './audit.js';
```

```bash
pnpm --filter @holo/audit typecheck
pnpm --filter @holo/custom-tools typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/audit/src/index.ts packages/custom-tools/src/audit.ts packages/custom-tools/src/index.ts
git commit -m "feat(audit): custom_tool.invoked event type + helper"
```

---

## Task 8: MCP tool factory (row → ToolDefinition)

**Files:**
- Create: `packages/custom-tools/src/mcp-tool-factory.ts`
- Modify: `packages/custom-tools/src/index.ts`

The factory builds an object that mirrors `ToolDefinition` from `apps/mcp/src/tools/index.ts` but lives in this package (apps/mcp can't import its own internal types from packages, so we duplicate the shape here and structurally type it on the consumer side).

- [ ] **Step 1: Implement factory**

`packages/custom-tools/src/mcp-tool-factory.ts`:

```ts
import type { DB } from '@holo/db';
import type { CustomToolRow } from './types.js';
import { expandArgs } from './expand-args.js';
import { validateInput } from './validate-input.js';
import { runCommand } from './spawn-runner.js';
import { emitCustomToolInvocation } from './audit.js';

export interface CustomToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isCustom: true;
  run(
    ctx: { db: DB; organizationId: string; userId?: string },
    args: unknown,
  ): Promise<{
    stdout: string;
    stderr: string;
    exit_code: number;
    truncated: boolean;
    duration_ms: number;
  }>;
}

export function buildCustomToolDefinition(tool: CustomToolRow): CustomToolDefinition {
  const prefixParts: string[] = ['CUSTOM'];
  if (tool.readOnly) prefixParts.push('read-only');
  if (tool.scope) prefixParts.push(`scope: ${tool.scope}`);
  const prefixed = `[${prefixParts.join(' | ')}] ${tool.description}`;

  return {
    name: tool.name,
    description: prefixed,
    inputSchema: tool.inputSchema,
    isCustom: true,
    async run(ctx, rawArgs) {
      const args = validateInput(tool.inputSchema, rawArgs);
      const argv = expandArgs(tool.argsTemplate, args);
      const filteredEnv: Record<string, string> = {};
      for (const k of tool.envAllowlist) {
        const v = process.env[k];
        if (typeof v === 'string') filteredEnv[k] = v;
      }
      const result = await runCommand({
        command: tool.command,
        argv,
        env: filteredEnv,
        timeoutMs: tool.timeoutMs,
        maxOutputBytes: tool.maxOutputBytes,
      });
      emitCustomToolInvocation({ db: ctx.db, tool, args, userId: ctx.userId, result });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exit_code: result.exitCode,
        truncated: result.truncated,
        duration_ms: result.durationMs,
      };
    },
  };
}
```

- [ ] **Step 2: Re-export + typecheck**

```ts
// packages/custom-tools/src/index.ts
export { buildCustomToolDefinition } from './mcp-tool-factory.js';
export type { CustomToolDefinition } from './mcp-tool-factory.js';
```

```bash
pnpm --filter @holo/custom-tools typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/custom-tools/src/mcp-tool-factory.ts packages/custom-tools/src/index.ts
git commit -m "feat(custom-tools): MCP tool definition factory"
```

---

## Task 9: MCP wiring — `listTools(ctx)` becomes async + ctx-aware

**Files:**
- Modify: `apps/mcp/src/tools/index.ts`
- Modify: `apps/mcp/src/jsonrpc.ts`
- Modify: `apps/mcp/package.json` — add `@holo/custom-tools` workspace dep

- [ ] **Step 1: Add dependency**

In `apps/mcp/package.json` `dependencies`, add:

```json
"@holo/custom-tools": "workspace:*"
```

Run `pnpm install`.

- [ ] **Step 2: Update `listTools` to accept ctx and return Promise**

In `apps/mcp/src/tools/index.ts`:

- Change the function signature to `export async function listTools(ctx: ToolContext): Promise<ToolDefinition[]>`.
- Build the static built-in array as today.
- After it, query custom tools via `@holo/custom-tools` and append:

```ts
import { listCustomTools, buildCustomToolDefinition } from '@holo/custom-tools';

// inside listTools, after the static `return [...]` becomes a `const builtIns = [...]`:
const customRows = await listCustomTools(ctx.db, ctx.organizationId);
const customDefs: ToolDefinition[] = customRows.map((row) => {
  const def = buildCustomToolDefinition(row);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    async run(toolCtx, args) {
      return def.run(
        { db: toolCtx.db, organizationId: toolCtx.organizationId, userId: toolCtx.userId },
        args,
      );
    },
  };
});
return [...builtIns, ...customDefs];
```

If `ToolContext` lacks `userId`, add it as an optional field in this file's `ToolContext` interface (the resolveContext in `apps/mcp/src/main.ts` already has `user.id` — pass it through).

- [ ] **Step 3: Update `apps/mcp/src/main.ts` resolveContext**

Add `userId: user.id` to the returned context object so custom-tool audit emits know who invoked.

- [ ] **Step 4: Update both `listTools()` call sites in `jsonrpc.ts`**

```ts
// tools/list:
const tools = (await listTools(ctx)).map((t) => ({ ... }));

// tools/call:
const tool = (await listTools(ctx)).find((t) => t.name === params.name);
```

(Calling it twice is fine for v0.3; cache later if profiling shows latency.)

- [ ] **Step 5: Typecheck + run all MCP tests**

```bash
pnpm --filter @holo/mcp typecheck
pnpm --filter @holo/mcp test
```

Expected: pass. Existing tests should be unaffected because `customRows` is `[]` for any org with no registered tools.

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/src/tools/index.ts apps/mcp/src/jsonrpc.ts apps/mcp/src/main.ts apps/mcp/package.json pnpm-lock.yaml
git commit -m "feat(mcp): merge custom tools into tools/list and tools/call"
```

---

## Task 10: authorization rule — custom tools never auto-allowed

**Files:**
- Modify: `apps/mcp/src/middleware/allowlist.ts`
- Modify: `apps/mcp/test/allowlist.test.ts`
- Modify: `apps/mcp/src/jsonrpc.ts` — pass custom-tool name set into `checkToolAllowed`

- [ ] **Step 1: Extend `checkToolAllowed` signature with failing tests**

In `apps/mcp/test/allowlist.test.ts`, add new cases:

```ts
describe('checkToolAllowed (custom tools)', () => {
  const customs = new Set(['bigquery_analytics_query']);

  it('blocks custom tool when allowlist is empty (no auto-allow)', () => {
    expect(checkToolAllowed('bigquery_analytics_query', [], { customToolNames: customs })).toBe(false);
  });

  it('allows custom tool when listed in allowlist', () => {
    expect(
      checkToolAllowed('bigquery_analytics_query', ['bigquery_analytics_query'], { customToolNames: customs }),
    ).toBe(true);
  });

  it('still allows built-in with empty allowlist (regression)', () => {
    expect(checkToolAllowed('search', [], { customToolNames: customs })).toBe(true);
  });

  it('blocks unknown custom tool not in allowlist', () => {
    expect(checkToolAllowed('bigquery_analytics_query', ['search'], { customToolNames: customs })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

```bash
pnpm --filter @holo/mcp test -- allowlist
```

- [ ] **Step 3: Update `checkToolAllowed`**

`apps/mcp/src/middleware/allowlist.ts`:

```ts
const ALWAYS_ALLOWED = new Set(['execute_skill', 'list_skills', 'get_skill']);

export interface CheckToolAllowedOpts {
  /** Names of custom (DB-registered) tools for the active org. */
  customToolNames?: ReadonlySet<string>;
}

/**
 * Returns true if the tool is permitted given the active skill's allowlist.
 *
 * Built-ins:  empty allowlist ⇒ all allowed; ALWAYS_ALLOWED set bypasses.
 * Customs:    NEVER auto-allowed; must be explicitly named in the allowlist.
 */
export function checkToolAllowed(
  toolName: string,
  allowlist: string[],
  opts: CheckToolAllowedOpts = {},
): boolean {
  if (ALWAYS_ALLOWED.has(toolName)) return true;
  const isCustom = opts.customToolNames?.has(toolName) ?? false;
  if (isCustom) return allowlist.includes(toolName);
  if (allowlist.length === 0) return true;
  return allowlist.includes(toolName);
}
```

- [ ] **Step 4: Pass `customToolNames` from `jsonrpc.ts`**

In `apps/mcp/src/jsonrpc.ts`, before the `checkToolAllowed` call inside the `tools/call` branch:

```ts
const allTools = await listTools(ctx);
const customToolNames = new Set(
  allTools.filter((t) => t.name.toLowerCase() === t.name && /* custom */ false).map((t) => t.name),
);
```

That heuristic is wrong — instead, change `ToolDefinition` in `apps/mcp/src/tools/index.ts` to include an optional `isCustom?: boolean` flag, set by the custom-tool branch in Task 9. Then:

```ts
const allTools = await listTools(ctx);
const customToolNames = new Set(allTools.filter((t) => t.isCustom).map((t) => t.name));
const tool = allTools.find((t) => t.name === params.name);
// ...
if (!checkToolAllowed(params.name, activeAllowlist, { customToolNames })) { ... }
```

Update the `ToolDefinition` interface accordingly and set `isCustom: true` on custom defs in the Task 9 mapping (replace the previous mapping with a version that preserves the flag).

- [ ] **Step 5: Run all MCP tests**

```bash
pnpm --filter @holo/mcp test
```

- [ ] **Step 6: Commit**

```bash
git add apps/mcp/src/middleware/allowlist.ts \
        apps/mcp/test/allowlist.test.ts \
        apps/mcp/src/jsonrpc.ts \
        apps/mcp/src/tools/index.ts
git commit -m "feat(mcp): custom tools never auto-allowed; allowlist must name them"
```

---

## Task 11: CLI — `holo tool register`

**Files:**
- Create: `packages/cli/src/commands/tool-register.ts`
- Create: `packages/cli/src/commands/tool.ts`
- Modify: `packages/cli/src/main.ts`
- Modify: `packages/cli/package.json` — add `@holo/custom-tools` workspace dep

- [ ] **Step 1: Add dep and `tool` group**

In `packages/cli/package.json` `dependencies`, add `"@holo/custom-tools": "workspace:*"`. Run `pnpm install`.

`packages/cli/src/commands/tool.ts`:

```ts
import type { Command } from 'commander';
import { runToolRegister } from './tool-register.js';
import { runToolList } from './tool-list.js';
import { runToolShow } from './tool-show.js';
import { runToolUnregister } from './tool-unregister.js';
import { resolveDeps } from '../deps.js';

export function registerToolCommand(program: Command): void {
  const tool = program.command('tool').description('manage custom MCP tools (CLI-as-tool)');

  tool
    .command('register')
    .requiredOption('--name <name>', 'tool name (lowercase, 3-64 chars)')
    .requiredOption('--description <text>', 'human-readable description')
    .requiredOption('--command <bin>', 'binary to invoke (must be on PATH)')
    .requiredOption('--schema-file <path>', 'JSON Schema file for tool inputs')
    .option('--arg <part...>', 'argv template part (repeatable, order-preserved)')
    .option('--env-allow <var...>', 'env variable name to pass through (repeatable)')
    .option('--scope <text>', 'free-form audit label')
    .option('--read-only', 'advisory: tool only reads (does not enforce)', false)
    .option('--timeout-ms <n>', 'spawn timeout in ms (max 60000)', '30000')
    .option('--max-output-bytes <n>', 'stdout/stderr cap each (max 1048576)', '262144')
    .action(async (opts: Record<string, unknown>) => {
      const deps = resolveDeps();
      const id = await runToolRegister({
        db: deps.db,
        organizationId: deps.organizationId,
        userId: deps.userId,
        name: opts.name as string,
        description: opts.description as string,
        command: opts.command as string,
        schemaFile: opts.schemaFile as string,
        argsTemplate: (opts.arg as string[] | undefined) ?? [],
        envAllowlist: (opts.envAllow as string[] | undefined) ?? [],
        scope: (opts.scope as string | undefined) ?? null,
        readOnly: Boolean(opts.readOnly),
        timeoutMs: Number(opts.timeoutMs),
        maxOutputBytes: Number(opts.maxOutputBytes),
      });
      console.log(`registered ${id}`);
    });

  tool
    .command('list')
    .description('list registered custom tools')
    .action(async () => {
      const deps = resolveDeps();
      process.stdout.write(await runToolList({ db: deps.db, organizationId: deps.organizationId }));
    });

  tool
    .command('show')
    .argument('<name>')
    .action(async (name: string) => {
      const deps = resolveDeps();
      process.stdout.write(
        await runToolShow({ db: deps.db, organizationId: deps.organizationId, name }),
      );
    });

  tool
    .command('unregister')
    .argument('<name>')
    .action(async (name: string) => {
      const deps = resolveDeps();
      const ok = await runToolUnregister({
        db: deps.db,
        organizationId: deps.organizationId,
        name,
      });
      console.log(ok ? `unregistered ${name}` : `not found: ${name}`);
    });
}
```

- [ ] **Step 2: Implement `runToolRegister`**

`packages/cli/src/commands/tool-register.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { DB } from '@holo/db';
import { createCustomTool } from '@holo/custom-tools';
import { holoError, ErrorCode } from '@holo/errors';

export interface RunToolRegisterInput {
  db: DB;
  organizationId: string;
  userId: string;
  name: string;
  description: string;
  command: string;
  schemaFile: string;
  argsTemplate: string[];
  envAllowlist: string[];
  scope: string | null;
  readOnly: boolean;
  timeoutMs: number;
  maxOutputBytes: number;
}

export async function runToolRegister(input: RunToolRegisterInput): Promise<string> {
  let inputSchema: Record<string, unknown>;
  try {
    const raw = readFileSync(input.schemaFile, 'utf8');
    inputSchema = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Could not read schema file ${input.schemaFile}`,
      fix: 'Verify the path and that the file is valid JSON.',
      cause: err instanceof Error ? err : undefined,
    });
  }
  return createCustomTool(input.db, {
    organizationId: input.organizationId,
    createdBy: input.userId,
    name: input.name,
    description: input.description,
    command: input.command,
    argsTemplate: input.argsTemplate,
    inputSchema,
    envAllowlist: input.envAllowlist,
    scope: input.scope,
    readOnly: input.readOnly,
    timeoutMs: input.timeoutMs,
    maxOutputBytes: input.maxOutputBytes,
  });
}
```

- [ ] **Step 3: Wire into main.ts**

In `packages/cli/src/main.ts`:

```ts
import { registerToolCommand } from './commands/tool.js';
// ...
registerToolCommand(program);
```

- [ ] **Step 4: Confirm `resolveDeps()` returns `userId`**

Check `packages/cli/src/deps.ts` — if it doesn't already return `userId`, extend it. The CLI runs in single-tenant mode in v0.2 (one user per host); using the org owner's id is acceptable. Document the assumption in a comment.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @holo/cli typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/tool.ts \
        packages/cli/src/commands/tool-register.ts \
        packages/cli/src/main.ts \
        packages/cli/src/deps.ts \
        packages/cli/package.json \
        pnpm-lock.yaml
git commit -m "feat(cli): holo tool register"
```

---

## Task 12: CLI — `holo tool list / show / unregister`

**Files:**
- Create: `packages/cli/src/commands/tool-list.ts`
- Create: `packages/cli/src/commands/tool-show.ts`
- Create: `packages/cli/src/commands/tool-unregister.ts`

- [ ] **Step 1: Implement list**

`packages/cli/src/commands/tool-list.ts`:

```ts
import type { DB } from '@holo/db';
import { listCustomTools } from '@holo/custom-tools';

export async function runToolList(input: { db: DB; organizationId: string }): Promise<string> {
  const rows = await listCustomTools(input.db, input.organizationId);
  if (rows.length === 0) return 'no custom tools registered\n';
  const lines = rows.map(
    (r) =>
      `${r.name}\t${r.command}\t${r.readOnly ? 'read-only' : 'read-write'}\t${r.scope ?? ''}`,
  );
  return `name\tcommand\tmode\tscope\n${lines.join('\n')}\n`;
}
```

- [ ] **Step 2: Implement show**

`packages/cli/src/commands/tool-show.ts`:

```ts
import type { DB } from '@holo/db';
import { getCustomToolByName } from '@holo/custom-tools';
import { holoError, ErrorCode } from '@holo/errors';

export async function runToolShow(input: {
  db: DB;
  organizationId: string;
  name: string;
}): Promise<string> {
  const row = await getCustomToolByName(input.db, input.organizationId, input.name);
  if (!row) {
    throw holoError({
      code: ErrorCode.HOLO_NOT_FOUND,
      problem: `Custom tool '${input.name}' not found`,
      fix: 'Run `holo tool list` to see registered tools.',
    });
  }
  return JSON.stringify(row, null, 2) + '\n';
}
```

- [ ] **Step 3: Implement unregister**

`packages/cli/src/commands/tool-unregister.ts`:

```ts
import type { DB } from '@holo/db';
import { deleteCustomToolByName } from '@holo/custom-tools';

export async function runToolUnregister(input: {
  db: DB;
  organizationId: string;
  name: string;
}): Promise<boolean> {
  return deleteCustomToolByName(input.db, input.organizationId, input.name);
}
```

- [ ] **Step 4: Typecheck and smoke**

```bash
pnpm --filter @holo/cli typecheck
node packages/cli/src/main.ts tool --help
```

Expected: `tool register|list|show|unregister` shown.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/tool-list.ts \
        packages/cli/src/commands/tool-show.ts \
        packages/cli/src/commands/tool-unregister.ts
git commit -m "feat(cli): holo tool list/show/unregister"
```

---

## Task 13: integration test — register → list → invoke roundtrip

**Files:**
- Create: `apps/mcp/test/custom-tools-roundtrip.test.ts`

This test uses the live Postgres (same as other schema tests) and a fixture binary. It exercises:
1. Insert a custom tool row directly via `createCustomTool`.
2. Build a JSON-RPC `tools/list` request and confirm the new tool appears with the `[CUSTOM]` prefix.
3. Build a `tools/call` request with valid args and confirm the fixture echoes argv.
4. Confirm an audit-log entry was written.

- [ ] **Step 1: Write the test**

`apps/mcp/test/custom-tools-roundtrip.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createDb, schema } from '@holo/db';
import { createCustomTool, deleteCustomToolByName } from '@holo/custom-tools';
import { mountMcp } from '../src/jsonrpc.js';

const here = dirname(fileURLToPath(import.meta.url));
const ECHO = resolve(here, '../../../packages/custom-tools/test/fixtures/echo-tool.sh');
const url = process.env.DATABASE_URL ?? 'postgresql://holo:holo@localhost:5436/holo';

let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof createDb>;
let app: Hono;
let orgId: string;
let userId: string;

beforeAll(async () => {
  sql = postgres(url, { max: 1 });
  db = createDb(url);
  // Reuse the first org/user in the DB; tests assume seeded data exists.
  const orgRow = await sql<{ id: string }[]>`SELECT id FROM organization LIMIT 1`;
  const userRow = await sql<{ id: string }[]>`SELECT id FROM "user" LIMIT 1`;
  orgId = orgRow[0]!.id;
  userId = userRow[0]!.id;

  app = new Hono();
  mountMcp(app, {
    db,
    async resolveContext() {
      return { db, organizationId: orgId, userId, userSubjects: [`org:${orgId}`], activeToolAllowlist: ['echo_argv'] };
    },
  });
});

afterAll(async () => {
  await deleteCustomToolByName(db, orgId, 'echo_argv').catch(() => {});
  await sql.end();
});

async function jsonRpc(method: string, params: unknown): Promise<unknown> {
  const res = await app.fetch(
    new Request('http://test/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return res.json();
}

describe('custom tool roundtrip', () => {
  it('registers, lists, and invokes a custom tool end-to-end', async () => {
    await createCustomTool(db, {
      organizationId: orgId,
      createdBy: userId,
      name: 'echo_argv',
      description: 'echo a phrase',
      command: ECHO,
      argsTemplate: ['{{phrase}}'],
      inputSchema: {
        type: 'object',
        properties: { phrase: { type: 'string' } },
        required: ['phrase'],
        additionalProperties: false,
      },
      envAllowlist: [],
      scope: 'test',
      readOnly: true,
      timeoutMs: 5000,
      maxOutputBytes: 8192,
    });

    const listed = (await jsonRpc('tools/list', {})) as {
      result: { tools: Array<{ name: string; description: string }> };
    };
    const echo = listed.result.tools.find((t) => t.name === 'echo_argv');
    expect(echo).toBeDefined();
    expect(echo!.description).toContain('[CUSTOM');
    expect(echo!.description).toContain('read-only');
    expect(echo!.description).toContain('scope: test');

    const called = (await jsonRpc('tools/call', {
      name: 'echo_argv',
      arguments: { phrase: 'hello-world' },
    })) as { result: { content: Array<{ text: string }> } };
    const payload = JSON.parse(called.result.content[0]!.text) as {
      stdout: string;
      exit_code: number;
    };
    expect(payload.exit_code).toBe(0);
    expect(payload.stdout).toContain('hello-world');

    // Audit row written
    const audit = await sql<{ event_type: string }[]>`
      SELECT event_type FROM audit_events
       WHERE organization_id = ${orgId}
         AND event_type = 'custom_tool.invoked'
       ORDER BY created_at DESC
       LIMIT 1
    `;
    expect(audit[0]?.event_type).toBe('custom_tool.invoked');
  });

  it('blocks invocation when active allowlist excludes the tool', async () => {
    const isolatedApp = new Hono();
    mountMcp(isolatedApp, {
      db,
      async resolveContext() {
        return {
          db,
          organizationId: orgId,
          userId,
          userSubjects: [`org:${orgId}`],
          activeToolAllowlist: ['search'], // does NOT include echo_argv
        };
      },
    });
    const res = await isolatedApp.fetch(
      new Request('http://test/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'echo_argv', arguments: { phrase: 'x' } },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run**

```bash
pnpm --filter @holo/db migrate
pnpm --filter @holo/mcp test -- custom-tools-roundtrip
```

Expected: pass. If your dev DB has no organization seeded, run `pnpm --filter @holo/db seed` (or the equivalent fixture command used in the repo) first.

- [ ] **Step 3: Commit**

```bash
git add apps/mcp/test/custom-tools-roundtrip.test.ts
git commit -m "test(mcp): custom tool register → list → invoke roundtrip"
```

---

## Task 14: docs + roadmap tick

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `README.md` (only if a "Custom tools" section is warranted; otherwise skip)

- [ ] **Step 1: Tick the roadmap**

In `docs/ROADMAP.md`, find the v0.2 line:

```
- [ ] **CLI-as-tool registration** — `holo tool register --command "<cli>" ...
```

Change `[ ]` to `[x]`.

- [ ] **Step 2: README mention (optional)**

Add a short subsection under "What you can do with holo" or equivalent:

```md
### Custom tools (CLI-as-tool)

Expose any CLI invocation as a per-org MCP tool. Example:

    holo tool register \
      --name bigquery_analytics_query \
      --command bq \
      --arg query --arg --format=json --arg "{{sql}}" \
      --schema-file ./bq-tool.schema.json \
      --env-allow GOOGLE_APPLICATION_CREDENTIALS \
      --scope dataset:analytics_readonly \
      --read-only

See `docs/superpowers/specs/2026-05-01-cli-as-tool-registration-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md README.md
git commit -m "docs: tick CLI-as-tool registration on the v0.2 roadmap"
```

---

## Final verification

Before opening a PR:

- [ ] Full repo lint: `pnpm -r lint`
- [ ] Full repo typecheck: `pnpm -r typecheck`
- [ ] Full repo test: `pnpm -r test`
- [ ] Spec self-review: re-read the spec and confirm every section maps to a task above.
- [ ] Manually exercise the CLI end-to-end against a local instance:
  ```bash
  echo '{"type":"object","properties":{"phrase":{"type":"string"}},"required":["phrase"],"additionalProperties":false}' > /tmp/echo.schema.json
  pnpm --filter @holo/cli build  # if the CLI is built
  node packages/cli/src/main.ts tool register \
    --name local_echo \
    --description 'local echo' \
    --command echo \
    --arg '{{phrase}}' \
    --schema-file /tmp/echo.schema.json
  node packages/cli/src/main.ts tool list
  node packages/cli/src/main.ts tool show local_echo
  node packages/cli/src/main.ts tool unregister local_echo
  ```
- [ ] Run `/review` (gstack pre-landing review) before `/ship`.

---

## Plan self-review

**Spec coverage:**
- §1 CLI surface → Tasks 11, 12.
- §2 Storage / `custom_tools` table → Task 1.
- §3 MCP wiring → Tasks 8, 9.
- §4 Authorization slot-in → Task 10.
- §5 Read-only honesty → Task 8 (description prefix), Task 7 (audit meta), spec doc.
- §6 MCP description shape → Task 8.
- §7 Audit + observability → Task 7, Task 13 (assertion).
- §8 Test plan → Tasks 3, 4, 5, 10, 13.
- §9 Out of scope → not implemented (correct).

No spec sections without a task. No tasks without spec backing.

**Placeholder scan:** none. Every step has a code block where code is required and a command where a command is required.

**Type consistency:** `CustomToolRow`, `RunResult`, `RunCommandInput`, `CustomToolDefinition`, `CreateCustomToolInput` — names used consistently across Tasks 2–13. `expandArgs`, `validateInput`, `runCommand`, `buildCustomToolDefinition`, `emitCustomToolInvocation`, `listCustomTools`, `getCustomToolByName`, `createCustomTool`, `deleteCustomToolByName` — names used consistently. `checkToolAllowed` signature change in Task 10 propagates to a single call site in Task 10 itself (`apps/mcp/src/jsonrpc.ts`).

**Scope:** single migration, one new package, one CLI command group, one MCP wiring slice. Single implementation plan. Done.
