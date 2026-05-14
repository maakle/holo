/**
 * `bash` MCP tool — RFC 0009.
 *
 * Wraps `vercel-labs/just-bash` over a `HoloFs` instance so the agent gets a
 * read-only POSIX shell over the synced context. The agent's path-shaped
 * mental model — `/slack/#engineering/2026-05-14/thread-123.md` — is just
 * the surface; underneath, every `readdir`/`stat`/`readFile` applies the
 * caller's `acl_subjects && $userSubjects` filter at the SQL layer.
 *
 * Why one big tool vs. five small ones (`ls`, `grep`, `cat`, …):
 *   - Stays under the ~30-MCP-tool ceiling Anthropic/Docker warn agents
 *     hit. Holo's `bash` + `search` = 2 retrieval tools, regardless of
 *     how many connectors land.
 *   - Composition: `grep -rl Acme /slack | head -20` in one round-trip
 *     vs. five.
 *   - 70+ Unix commands for free.
 *
 * Why `search` stays as a separate tool:
 *   - Weaker models that generate sloppy bash still have a single-call path
 *     to semantic retrieval.
 *   - Hybrid RRF is a SQL primitive, not a Unix one; cleaner as a typed tool.
 *
 * V1 allowlist locked at 11 commands. We expand based on telemetry, not
 * spec creep. Network and JS/Python execution are off (no `curl`, no
 * `python`, no `js-exec`).
 *
 * Telemetry: every call to this tool goes through the MCP gateway's
 * `recordAgentEvent` path (apps/gateway/src/mcp/transport.ts), which
 * records `{ tool: 'bash', inputJson: { script }, latencyMs, errorCode }`
 * to `mcp_invocations`. Per-command rollups (grep vs cat vs find) are
 * derivable from the script string post-hoc — see
 *   SELECT split_part(jsonb_extract_path_text(input_json, 'script'), ' ', 1) AS cmd,
 *          count(*) FROM mcp_invocations WHERE tool_name = 'bash' GROUP BY 1;
 * An AST-level plugin via just-bash's `CommandCollectorPlugin` is a v2
 * upgrade — defer until we have a real per-command rollup question to
 * answer.
 */
import { z } from 'zod';
import { Bash, type IFileSystem, type BashOptions } from 'just-bash';

type ExecutionLimits = NonNullable<BashOptions['executionLimits']>;
import { HoloFs, type HoloFsDeps } from '@holo/holofs';
import { holoFsToIFileSystem } from './bash-fs-adapter';
import type { ToolContext } from '../registry';

/** Wall-clock cap per `bash` invocation. just-bash has command-count and
 * loop-iteration caps; wall-clock is enforced via Promise.race here. */
const BASH_TIMEOUT_MS = 5_000;

/** Max bytes of stdout we return to the agent. just-bash will keep producing
 * output up to its own internal `maxStringLength`; we truncate at this layer
 * to bound the token cost on the agent side. */
const BASH_MAX_STDOUT_BYTES = 256_000;

/** Max bytes of stderr (smaller — stderr is usually short error messages). */
const BASH_MAX_STDERR_BYTES = 32_000;

/**
 * V1 command allowlist. Everything in here is read-only over the FS; nothing
 * here touches the network or executes user-supplied code. Defer `awk`,
 * `sed`, `jq`, `xargs` to v2 based on telemetry.
 */
const V1_COMMAND_ALLOWLIST = [
  'ls', 'cat', 'grep', 'find', 'head', 'tail', 'wc', 'sort', 'uniq', 'tree', 'echo',
] as const;

const V1_LIMITS: ExecutionLimits = {
  maxCommandCount: 1000,
  maxLoopIterations: 1000,
  maxCallDepth: 50,
  maxStringLength: 1_000_000,
};

export const bashInputSchema = z.object({
  script: z
    .string()
    .min(1)
    .max(4000)
    .describe(
      'Bash script to run against the virtual filesystem. Paths look like '
        + '/slack/#engineering/2026-05-14/thread-123.md. Read-only — writes throw EROFS.',
    ),
});

export type BashInput = z.infer<typeof bashInputSchema>;

export interface BashToolOutput {
  stdout: string;
  stderr: string;
  exit_code: number;
  /** Set when the wall-clock cap fired. */
  timed_out?: true;
  /** Set when stdout/stderr was truncated. */
  truncated?: { stdout?: true; stderr?: true };
}

export interface BashToolContext {
  db: ToolContext['db'];
  organizationId: string;
  userSubjects: string[];
}

function truncate(s: string, maxBytes: number): { value: string; truncated: boolean } {
  // Cheap byte-aware truncation: TextEncoder counts UTF-8 bytes. Slice at
  // character boundary, accept slight under-shoot rather than splitting a
  // multibyte sequence.
  const encoder = new TextEncoder();
  if (encoder.encode(s).length <= maxBytes) return { value: s, truncated: false };
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (encoder.encode(s.slice(0, mid)).length <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { value: s.slice(0, lo) + '\n[... truncated ...]', truncated: true };
}

class BashTimeoutError extends Error {
  constructor() {
    super('bash execution exceeded wall-clock cap');
    this.name = 'BashTimeoutError';
  }
}

export async function runBashTool(
  ctx: BashToolContext,
  rawInput: unknown,
): Promise<BashToolOutput> {
  const input = bashInputSchema.parse(rawInput);

  const holoFs = new HoloFs({
    db: ctx.db,
    organizationId: ctx.organizationId,
    userSubjects: ctx.userSubjects,
  } satisfies HoloFsDeps);
  const fs: IFileSystem = holoFsToIFileSystem(holoFs);

  const bash = new Bash({
    fs,
    cwd: '/',
    commands: [...V1_COMMAND_ALLOWLIST],
    executionLimits: V1_LIMITS,
    // python/javascript/network all left off — no `curl`, no `python`,
    // no `js-exec`.
    //
    // just-bash's defenseInDepth defaults to `true` and monkey-patches
    // globals like `setImmediate` during script execution. That blocks
    // postgres-js's connection flush (it relies on setImmediate), which
    // means *every* HoloFs read fails with SecurityViolationError. With
    // our V1 allowlist there's no eval/Function/network surface for the
    // sandbox to defend against, so disabling it is the right call —
    // primary security is the command allowlist + the read-only HoloFs,
    // not in-process global patching.
    defenseInDepth: false,
  });

  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      timedOut = true;
      reject(new BashTimeoutError());
    }, BASH_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([bash.exec(input.script), timeoutPromise]);
    const stdout = truncate(result.stdout, BASH_MAX_STDOUT_BYTES);
    const stderr = truncate(result.stderr, BASH_MAX_STDERR_BYTES);
    const truncation: BashToolOutput['truncated'] = {};
    if (stdout.truncated) truncation.stdout = true;
    if (stderr.truncated) truncation.stderr = true;
    return {
      stdout: stdout.value,
      stderr: stderr.value,
      exit_code: result.exitCode,
      ...(Object.keys(truncation).length > 0 ? { truncated: truncation } : {}),
    };
  } catch (err) {
    if (timedOut || err instanceof BashTimeoutError) {
      return {
        stdout: '',
        stderr: `bash: timed out after ${BASH_TIMEOUT_MS}ms`,
        exit_code: 124,
        timed_out: true,
      };
    }
    // Anything else is a bug in our wiring or a hard limit hit. Re-throw so
    // the MCP layer reports it as a tool failure rather than silently
    // returning a malformed result.
    throw err;
  }
}

export const BASH_TOOL_DESCRIPTION =
  'Run a read-only bash script against the synced-context virtual '
    + 'filesystem. Use `grep -r <pattern> <path>` for keyword search, '
    + '`find <path> -name <glob>` for filename search, `cat <path>` to read '
    + 'a file, `ls <path>` to list. Paths look like '
    + '`/slack/#engineering/2026-05-14/thread-123.md` or '
    + '`/github/acme/api/pulls/42.md`. Use the `search` tool instead for '
    + "fuzzy/semantic queries like 'customer complaints about pricing'.";

export const BASH_V1_COMMAND_ALLOWLIST: readonly string[] = V1_COMMAND_ALLOWLIST;
