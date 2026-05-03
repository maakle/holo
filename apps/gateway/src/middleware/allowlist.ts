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
