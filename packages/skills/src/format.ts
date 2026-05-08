import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { holoError, ErrorCode } from '@holo/errors';
import type { SkillDoc, SkillFrontmatter } from './types';

export function parseSkill(content: string): SkillDoc {
  const { data, content: body } = matter(content);
  if (typeof data['name'] !== 'string' || !data['name']) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Skill frontmatter must have a non-empty "name" field',
      fix: 'Add a "name" field with a non-empty string value to the skill YAML frontmatter.',
    });
  }
  if (typeof data['description'] !== 'string' || !data['description']) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Skill frontmatter must have a non-empty "description" field',
      fix: 'Add a "description" field with a non-empty string value to the skill YAML frontmatter.',
    });
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
