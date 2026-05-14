/**
 * Tiny SQL binding helpers used by both `@holo/db` and downstream packages
 * that hold the `DB` handle. Each helper exists to defend against a
 * specific postgres-js / drizzle binding trap, not to provide general SQL
 * sugar — keep this file minimal.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * Bind a JS number as Postgres `integer`.
 *
 * **Why this exists.** Drizzle (via postgres-js) binds JS numbers as `text`
 * parameters by default. That's fine for most queries, but Postgres has
 * function overloads where the type matters — most notoriously:
 *
 *   - `substring(text, integer)` returns a fixed-length slice
 *   - `substring(text, text)`    runs POSIX regex matching
 *
 * Passing `2` as text to `substring('foo', 2)` silently calls the regex
 * form against the literal string `'2'`, which works *some* of the time
 * (returning the empty string or unexpected matches) and is brutally hard
 * to spot. The same shape bites `regexp_substr`, `regexp_split_to_array`,
 * and `array_position(array, value, start_at)`.
 *
 * Use `intParam(n)` whenever a query passes a JS number to a function
 * with an int/text overload. Free in the common case (no overload exists,
 * cast is a no-op); load-bearing in the dangerous case.
 *
 * @example
 * ```ts
 * await db.execute(sql`
 *   SELECT substring(path FROM ${intParam(prefixLen + 1)}) AS rest
 *   FROM source_artifacts WHERE …
 * `);
 * ```
 *
 * History: `packages/holofs/src/fs.ts:105` chose to do the path split
 * client-side specifically to avoid this trap. This helper is the
 * server-side answer — use it instead of moving more work to JS.
 */
export function intParam(value: number): SQL {
  if (!Number.isInteger(value)) {
    throw new Error(`intParam expects an integer, got ${value}`);
  }
  return sql`${value}::integer`;
}
