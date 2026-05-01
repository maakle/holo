export interface SkillFrontmatter {
  name: string;
  description: string;
  tools: string[];
  when_to_use?: string;
  tool_allowlist?: string[];  // explicit allowlist for execute_skill enforcement
  executable?: boolean;       // false = read-only skill reference, true = can be executed
  [key: string]: unknown;
}

export interface SkillDoc {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type SkillStatus = 'draft' | 'active' | 'archived';
