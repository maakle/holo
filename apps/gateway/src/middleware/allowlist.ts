import type { DB } from '@holo/db';
import { schema } from '@holo/db';
import { and, eq } from 'drizzle-orm';

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

/**
 * Resolve the active skill's `toolAllowlist` from the `x-active-skill-slug`
 * header. Empty array when no header is set, when the slug doesn't resolve,
 * or when the matched skill itself has an empty allowlist (which means
 * "allow all built-ins").
 *
 * Used by both the MCP transport and the REST router so a per-skill
 * allowlist is enforced on the same data either way the agent reaches the
 * gateway.
 */
export async function resolveActiveToolAllowlist(
  db: DB,
  organizationId: string,
  activeSkillSlugHeader: string | undefined,
): Promise<string[]> {
  if (!activeSkillSlugHeader) return [];
  const rows = await db
    .select({ toolAllowlist: schema.skills.toolAllowlist })
    .from(schema.skills)
    .where(
      and(
        eq(schema.skills.organizationId, organizationId),
        eq(schema.skills.slug, activeSkillSlugHeader),
        eq(schema.skills.status, 'active'),
      ),
    )
    .limit(1);
  return rows[0]?.toolAllowlist ?? [];
}
