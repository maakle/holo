/**
 * Server-side enforced default filters for a skill. The orchestrator narrows
 * (and rejects widening of) model-requested `search` filters against these.
 * See `mergeSearchFilters` in `./defaults`.
 */
export interface SkillDefaults {
  accountFilter?: {
    tier?: string[];
    owner?: string[];
    accountId?: string[];
  };
  /**
   * Either a relative window (`{ last: '14d' }`) or an absolute one
   * (`{ from, to }` as ISO-8601 strings). Both fields optional.
   */
  timeWindow?:
    | { last: string }
    | { from?: string; to?: string };
  provider?: string[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  tools: string[];
  when_to_use?: string;
  tool_allowlist?: string[];  // explicit allowlist for execute_skill enforcement
  executable?: boolean;       // false = read-only skill reference, true = can be executed
  defaults?: SkillDefaults;   // server-enforced default filters (RFC-0005)
  [key: string]: unknown;
}

export interface SkillDoc {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type SkillStatus = 'draft' | 'active' | 'archived';
