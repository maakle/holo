const ALWAYS_ALLOWED = new Set(['execute_skill', 'list_skills', 'get_skill']);

/**
 * Returns true if the tool is permitted given the active skill's allowlist.
 * An empty allowlist means all tools are permitted (no restriction).
 * execute_skill, list_skills, and get_skill are always allowed.
 */
export function checkToolAllowed(toolName: string, allowlist: string[]): boolean {
  if (ALWAYS_ALLOWED.has(toolName)) return true;
  if (allowlist.length === 0) return true;
  return allowlist.includes(toolName);
}
