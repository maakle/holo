export interface SkillFrontmatter {
  name: string;
  description: string;
  tools: string[];
  when_to_use?: string;
  [key: string]: unknown;
}

export interface SkillDoc {
  frontmatter: SkillFrontmatter;
  body: string;
}

export type SkillStatus = 'draft' | 'active' | 'archived';
