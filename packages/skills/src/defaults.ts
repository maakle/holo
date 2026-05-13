import { holoError, ErrorCode, HoloError } from '@holo/errors';
import type { SkillDefaults } from './types';

/**
 * Input filters that a model may pass to a `search` tool call. Mirrors the
 * orchestrator's search input schema (single provider for now; arrays kept
 * permissive in case the model passes one).
 */
export interface SearchFilters {
  provider?: string | string[];
  accountFilter?: {
    tier?: string[];
    owner?: string[];
    accountId?: string[];
  };
  timeWindow?:
    | { last?: string }
    | { from?: string; to?: string };
}

export interface MergeOptions {
  /**
   * When true (default), a model-requested value that's not a subset of the
   * skill default throws `HOLO_INVALID_INPUT`. Predictability over cleverness:
   * we surface the conflict instead of silently narrowing.
   */
  strict?: boolean;
}

function asArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v : [v];
}

function intersect(
  modelValues: string[] | undefined,
  defaultValues: string[],
  field: string,
  strict: boolean,
): string[] {
  if (modelValues === undefined) return defaultValues;
  const allowed = new Set(defaultValues);
  const widened = modelValues.filter((v) => !allowed.has(v));
  if (widened.length > 0 && strict) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Skill default narrows "${field}" to [${defaultValues.join(', ')}] but the model requested [${widened.join(', ')}].`,
      fix: `Remove the disallowed values or fork the skill and widen the "defaults.${field}" in the YAML.`,
    });
  }
  // Strict path throws above; non-strict path returns intersection.
  return modelValues.filter((v) => allowed.has(v));
}

/**
 * Merge model-requested search filters with skill defaults.
 *
 * The skill defaults are *enforceable*, not suggestible:
 *  - If the skill says `provider: ['pylon']`, the model cannot search github.
 *  - If the skill says `accountFilter.tier: ['T0', 'T1']`, the model cannot
 *    widen to T2.
 *  - In strict mode (default), a widening attempt throws — the orchestrator
 *    should surface the error to the user, not silently narrow.
 *
 * Time-window merging takes the more-restrictive of (default, model).
 */
export function mergeSearchFilters(
  modelRequested: SearchFilters,
  defaults: SkillDefaults | undefined,
  opts: MergeOptions = {},
): SearchFilters {
  const strict = opts.strict ?? true;
  if (!defaults) return modelRequested;

  const out: SearchFilters = { ...modelRequested };

  if (defaults.provider !== undefined) {
    const merged = intersect(asArray(modelRequested.provider), defaults.provider, 'provider', strict);
    // If model asked for a single string, return single string when possible.
    if (typeof modelRequested.provider === 'string' && merged.length === 1) {
      out.provider = merged[0];
    } else {
      out.provider = merged;
    }
  }

  if (defaults.accountFilter !== undefined) {
    const acct: SearchFilters['accountFilter'] = { ...modelRequested.accountFilter };
    for (const key of ['tier', 'owner', 'accountId'] as const) {
      const def = defaults.accountFilter[key];
      if (def === undefined) continue;
      acct[key] = intersect(modelRequested.accountFilter?.[key], def, `accountFilter.${key}`, strict);
    }
    out.accountFilter = acct;
  }

  if (defaults.timeWindow !== undefined) {
    // Relative windows: the more-restrictive duration wins. ISO ranges:
    // narrow `from` upward and `to` downward.
    if ('last' in defaults.timeWindow && defaults.timeWindow.last !== undefined) {
      const modelTw = modelRequested.timeWindow as { last?: string } | undefined;
      const modelLast = modelTw?.last;
      const defLast = defaults.timeWindow.last;
      out.timeWindow = { last: pickTighterDuration(modelLast, defLast, strict) };
    } else {
      const dtw = defaults.timeWindow as { from?: string; to?: string };
      const mtw = (modelRequested.timeWindow ?? {}) as { from?: string; to?: string };
      const merged: { from?: string; to?: string } = {};
      if (dtw.from || mtw.from) {
        merged.from = pickLater(dtw.from, mtw.from, strict, 'timeWindow.from');
      }
      if (dtw.to || mtw.to) {
        merged.to = pickEarlier(dtw.to, mtw.to, strict, 'timeWindow.to');
      }
      out.timeWindow = merged;
    }
  }

  return out;
}

const DURATION_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  M: 2_592_000_000, // ≈30d
  y: 31_536_000_000,
};

function durationToMs(d: string): number | null {
  const m = /^(\d+)([smhdwMy])$/.exec(d);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2]!;
  return n * (DURATION_UNIT_MS[unit] ?? 0);
}

function pickTighterDuration(modelD: string | undefined, defD: string, strict: boolean): string {
  if (!modelD) return defD;
  const m = durationToMs(modelD);
  const d = durationToMs(defD);
  if (m === null || d === null) return defD;
  if (m > d) {
    if (strict) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Skill default narrows timeWindow.last to "${defD}" but the model requested "${modelD}".`,
        fix: 'Use a tighter (smaller) window or fork the skill and widen the default.',
      });
    }
    return defD;
  }
  return modelD;
}

function pickLater(a: string | undefined, b: string | undefined, strict: boolean, field: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return a;
  // Model can narrow `from` later, not earlier (earlier = widening).
  // `a` is default, `b` is model.
  if (db < da) {
    if (strict) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Skill default narrows ${field} to "${a}" but the model requested "${b}".`,
        fix: 'Pick a value at or after the skill default.',
      });
    }
    return a;
  }
  return b;
}

function pickEarlier(a: string | undefined, b: string | undefined, strict: boolean, field: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (Number.isNaN(da) || Number.isNaN(db)) return a;
  // Model can narrow `to` earlier, not later (later = widening).
  if (db > da) {
    if (strict) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: `Skill default narrows ${field} to "${a}" but the model requested "${b}".`,
        fix: 'Pick a value at or before the skill default.',
      });
    }
    return a;
  }
  return b;
}

// Re-export for callers that catch this specific shape.
export { HoloError };
