import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import type { SkillDoc, SkillFrontmatter } from './types.js';

export function parseSkill(content: string): SkillDoc {
  const { data, content: body } = matter(content);
  if (typeof data['name'] !== 'string' || !data['name']) {
    throw new Error('Skill frontmatter must have a non-empty "name" field');
  }
  if (typeof data['description'] !== 'string' || !data['description']) {
    throw new Error('Skill frontmatter must have a non-empty "description" field');
  }
  const frontmatter: SkillFrontmatter = {
    name: data['name'] as string,
    description: data['description'] as string,
    tools: Array.isArray(data['tools']) ? (data['tools'] as string[]) : [],
    ...(data['when_to_use'] !== undefined ? { when_to_use: String(data['when_to_use']) } : {}),
  };
  return { frontmatter, body: body.trim() };
}

export function serializeSkill(skill: SkillDoc): string {
  return matter.stringify(skill.body, skill.frontmatter as Record<string, unknown>);
}

export function fingerprintSkill(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}
