import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import { holoError, ErrorCode } from '@holo/errors';
import type { SkillDefaults, SkillDoc, SkillFrontmatter } from './types';

function parseDefaults(raw: unknown): SkillDefaults | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: 'Skill frontmatter "defaults" must be an object',
      fix: 'Set defaults to an object with optional accountFilter, timeWindow, provider keys.',
    });
  }
  const r = raw as Record<string, unknown>;
  const out: SkillDefaults = {};

  if (r['accountFilter'] !== undefined) {
    if (typeof r['accountFilter'] !== 'object' || r['accountFilter'] === null || Array.isArray(r['accountFilter'])) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'defaults.accountFilter must be an object',
        fix: 'Use { tier: [...], owner: [...], accountId: [...] }.',
      });
    }
    const af = r['accountFilter'] as Record<string, unknown>;
    const acct: SkillDefaults['accountFilter'] = {};
    for (const key of ['tier', 'owner', 'accountId'] as const) {
      const v = af[key];
      if (v === undefined) continue;
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: `defaults.accountFilter.${key} must be a string[]`,
          fix: `Set ${key} to an array of strings, e.g. ['T0', 'T1'].`,
        });
      }
      acct[key] = v as string[];
    }
    if (Object.keys(acct).length > 0) out.accountFilter = acct;
  }

  if (r['timeWindow'] !== undefined) {
    if (typeof r['timeWindow'] !== 'object' || r['timeWindow'] === null || Array.isArray(r['timeWindow'])) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'defaults.timeWindow must be an object',
        fix: "Use { last: '14d' } or { from: ISO, to: ISO }.",
      });
    }
    const tw = r['timeWindow'] as Record<string, unknown>;
    if (tw['last'] !== undefined) {
      if (typeof tw['last'] !== 'string' || !/^\d+[smhdwMy]$/.test(tw['last'])) {
        throw holoError({
          code: ErrorCode.HOLO_INVALID_INPUT,
          problem: 'defaults.timeWindow.last must be a duration string like "14d"',
          fix: 'Use a number + unit suffix from s|m|h|d|w|M|y (e.g. "14d").',
        });
      }
      out.timeWindow = { last: tw['last'] };
    } else {
      const win: { from?: string; to?: string } = {};
      if (tw['from'] !== undefined) {
        if (typeof tw['from'] !== 'string') {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: 'defaults.timeWindow.from must be an ISO-8601 string',
            fix: 'Use a string like "2026-01-01T00:00:00Z".',
          });
        }
        win.from = tw['from'];
      }
      if (tw['to'] !== undefined) {
        if (typeof tw['to'] !== 'string') {
          throw holoError({
            code: ErrorCode.HOLO_INVALID_INPUT,
            problem: 'defaults.timeWindow.to must be an ISO-8601 string',
            fix: 'Use a string like "2026-12-31T23:59:59Z".',
          });
        }
        win.to = tw['to'];
      }
      if (win.from !== undefined || win.to !== undefined) out.timeWindow = win;
    }
  }

  if (r['provider'] !== undefined) {
    if (!Array.isArray(r['provider']) || r['provider'].some((p) => typeof p !== 'string')) {
      throw holoError({
        code: ErrorCode.HOLO_INVALID_INPUT,
        problem: 'defaults.provider must be a string[]',
        fix: "Set provider to an array of strings, e.g. ['pylon', 'grain'].",
      });
    }
    out.provider = r['provider'] as string[];
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

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
  const defaults = parseDefaults(data['defaults']);
  const frontmatter: SkillFrontmatter = {
    name: data['name'] as string,
    description: data['description'] as string,
    tools: Array.isArray(data['tools']) ? (data['tools'] as string[]) : [],
    ...(data['when_to_use'] !== undefined ? { when_to_use: String(data['when_to_use']) } : {}),
    ...(defaults !== undefined ? { defaults } : {}),
  };
  return { frontmatter, body: body.trim() };
}

export function serializeSkill(skill: SkillDoc): string {
  return matter.stringify(skill.body, skill.frontmatter as Record<string, unknown>);
}

export function fingerprintSkill(content: string): string {
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}
