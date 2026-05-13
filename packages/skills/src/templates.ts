/**
 * First-party skill *templates* — YAML files that ship with the repo and are
 * loaded into an org's `skills` table on demand (e.g. via `init` or the web
 * "install template" button). Distinct from `golden/*.md` which exists as a
 * fixture set for the discovery evaluator.
 *
 * Templates use YAML because the procedure body is plain prose; the
 * markdown-in-frontmatter shape of `parseSkill` would force every template
 * to escape leading hash characters. The loader translates YAML to the
 * canonical `SkillDoc` so existing executor / registry code can stay
 * unchanged.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import type { SkillDoc, SkillFrontmatter } from './types';
import { holoError, ErrorCode } from '@holo/errors';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1343 — see golden/index.ts for the rationale.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Hand-maintained registry. Adding a template = adding a file + a row here.
// The list is small enough that the overhead is fine and avoids the
// readdirSync-at-import-time pattern (which breaks the worker's
// CommonJS-via-tsx setup).
export const TEMPLATE_FILES = ['pre-call-brief.yaml'] as const;

export type TemplateFilename = (typeof TEMPLATE_FILES)[number];

export interface SkillTemplate {
  filename: string;
  doc: SkillDoc;
}

/**
 * Load a single template by filename. Throws a structured holoError when
 * the file is missing or the YAML is malformed; this surfaces clearly in
 * the install flow and keeps test failures actionable.
 */
export function loadTemplate(filename: TemplateFilename): SkillTemplate {
  const path = resolve(__dirname, '..', 'templates', filename);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (cause) {
    throw holoError({
      code: ErrorCode.HOLO_INTERNAL,
      problem: `Skill template not found: ${filename}`,
      fix: 'Verify the file exists at packages/skills/templates/ and is listed in TEMPLATE_FILES.',
      cause: String(cause),
    });
  }

  // gray-matter accepts pure YAML when wrapped in `---` fences with no body.
  // We do that here so the templates can stay as ergonomic YAML files
  // without forcing the author to learn the matter format.
  const parsed = matter(`---\n${raw}\n---\n`);
  const data = parsed.data;
  if (typeof data['name'] !== 'string' || !data['name']) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Template ${filename} missing required "name" field`,
      fix: 'Add a non-empty "name" string at the top of the YAML.',
    });
  }
  if (typeof data['description'] !== 'string' || !data['description']) {
    throw holoError({
      code: ErrorCode.HOLO_INVALID_INPUT,
      problem: `Template ${filename} missing required "description" field`,
      fix: 'Add a non-empty "description" string.',
    });
  }

  const procedure = typeof data['procedure'] === 'string' ? (data['procedure'] as string) : '';

  const frontmatter: SkillFrontmatter = {
    name: data['name'] as string,
    description: data['description'] as string,
    tools: Array.isArray(data['tools']) ? (data['tools'] as string[]) : [],
    ...(typeof data['when_to_use'] === 'string' ? { when_to_use: data['when_to_use'] } : {}),
    ...(Array.isArray(data['tool_allowlist'])
      ? { tool_allowlist: data['tool_allowlist'] as string[] }
      : {}),
    ...(typeof data['executable'] === 'boolean' ? { executable: data['executable'] } : {}),
  };

  return { filename, doc: { frontmatter, body: procedure.trim() } };
}

/** Load every shipped template — used by `init` / the install-templates job. */
export function loadAllTemplates(): SkillTemplate[] {
  return TEMPLATE_FILES.map((f) => loadTemplate(f));
}
