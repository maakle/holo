/**
 * v0.1 TTHW (time-to-hello-world) telemetry — gateway side.
 *
 * The CLI's `holo init` writes the install ID and start timestamp into
 * env vars (HOLO_TELEMETRY_INSTALL_ID / HOLO_TELEMETRY_STARTED_AT) and
 * an opt-in flag (HOLO_TELEMETRY_OPT_IN). When the gateway processes
 * the first successful MCP `search` call, this module:
 *
 *   1. Inserts a row into `tthw_reports` keyed by install_id. The
 *      ON CONFLICT DO NOTHING is the "fire once" gate — every search
 *      after the first is a no-op.
 *   2. Fires a fire-and-forget POST to HOLO_TELEMETRY_ENDPOINT carrying
 *      `{ installId, startedAtMs, finishedAtMs }`. Anonymous; no data
 *      content. The status row is updated when the POST resolves.
 *
 * Designed to never throw on the search hot path — every error is
 * swallowed. Telemetry that breaks search is worse than no telemetry.
 */
import { sql } from 'drizzle-orm';
import type { DB } from '@holo/db';

export interface TthwEnv {
  installId?: string;
  startedAtMs?: number;
  optedIn?: boolean;
  endpoint?: string;
}

export interface TthwDeps {
  db: DB;
  env: TthwEnv;
  now?: () => number;
  fetchImpl?: typeof globalThis.fetch;
  /** Test seam — invoked instead of the real POST. */
  onPost?: (payload: TthwPayload) => Promise<{ ok: boolean }>;
}

export interface TthwPayload {
  installId: string;
  startedAtMs: number;
  finishedAtMs: number;
}

/**
 * Read TTHW env vars from a process.env-shaped object. Centralized so the
 * gateway doesn't sprinkle env reads across modules.
 */
export function readTthwEnv(env: Record<string, string | undefined>): TthwEnv {
  const startedRaw = env.HOLO_TELEMETRY_STARTED_AT;
  const startedAtMs = startedRaw ? Number.parseInt(startedRaw, 10) : undefined;
  return {
    installId: env.HOLO_TELEMETRY_INSTALL_ID,
    startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : undefined,
    optedIn: env.HOLO_TELEMETRY_OPT_IN === 'true',
    endpoint: env.HOLO_TELEMETRY_ENDPOINT,
  };
}

/**
 * Fire the TTHW report if (a) opt-in is true, (b) install ID + start
 * timestamp are present, (c) no row already exists for this install ID.
 *
 * Always resolves — never throws on the search path.
 */
export async function maybeReportTthw(deps: TthwDeps): Promise<void> {
  const { env } = deps;
  if (!env.optedIn) return;
  if (!env.installId) return;
  if (env.startedAtMs === undefined) return;

  const finishedAtMs = (deps.now ?? Date.now)();
  const status = env.endpoint ? 'pending' : 'noop';

  let inserted = false;
  try {
    const result = await deps.db.execute(sql`
      INSERT INTO tthw_reports (install_id, started_at_ms, finished_at_ms, report_status)
      VALUES (${env.installId}, ${env.startedAtMs}, ${finishedAtMs}, ${status})
      ON CONFLICT (install_id) DO NOTHING
      RETURNING install_id
    `);
    // postgres.js returns an array-like with a `count` property; treat both
    // shapes defensively because Drizzle's typing here is `unknown[]`.
    inserted =
      Array.isArray(result)
        ? result.length > 0
        : (result as { count?: number }).count !== undefined &&
          (result as { count: number }).count > 0;
  } catch {
    return; // local insert failed (e.g. table missing in tests); skip.
  }

  if (!inserted) return; // already reported by an earlier call
  if (status === 'noop') return; // endpoint not configured

  const payload: TthwPayload = {
    installId: env.installId,
    startedAtMs: env.startedAtMs,
    finishedAtMs,
  };

  // Fire and forget. The gateway must not await the POST on the search
  // hot path. We update the status when it resolves so operators can see
  // whether telemetry is reaching the endpoint.
  void postTthw({ ...deps, payload, status }).catch(() => {});
}

interface PostArgs extends TthwDeps {
  payload: TthwPayload;
  status: 'pending';
}

async function postTthw(args: PostArgs): Promise<void> {
  const ok = args.onPost
    ? (await args.onPost(args.payload)).ok
    : await defaultPost(args);
  try {
    await args.db.execute(sql`
      UPDATE tthw_reports
      SET report_status = ${ok ? 'sent' : 'failed'}
      WHERE install_id = ${args.payload.installId}
    `);
  } catch {
    // swallow — telemetry status update is best-effort.
  }
}

async function defaultPost(args: PostArgs): Promise<boolean> {
  const endpoint = args.env.endpoint;
  if (!endpoint) return false;
  try {
    const fetchImpl = args.fetchImpl ?? globalThis.fetch;
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args.payload),
    });
    return res.ok;
  } catch {
    return false;
  }
}
