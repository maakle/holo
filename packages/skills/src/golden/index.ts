import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkill } from '../format.js';
import type { SkillDoc } from '../types.js';

// CommonJS consumers (e.g. apps/worker, which uses `module: "CommonJS"` for
// NestJS decorators) typecheck this file's source through pnpm's workspace
// symlinks, and tsc rejects `import.meta` under CommonJS even though it
// works fine at runtime under tsx. @ts-ignore (rather than @ts-expect-error)
// because skills' own ESM tsconfig has no error here.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore TS1343
const __dirname = dirname(fileURLToPath(import.meta.url));

const GOLDEN_FILES = [
  '01-handle-refund-request.md',
  '02-escalate-critical-bug.md',
  '03-pr-security-review.md',
  '04-onboard-new-engineer.md',
  '05-write-postmortem.md',
  '06-quarterly-business-review-prep.md',
  '07-triage-support-ticket.md',
  '08-handle-churn-risk.md',
  '09-technical-interview-prep.md',
  '10-weekly-engineering-metrics.md',
] as const;

export type GoldenSkillFilename = (typeof GOLDEN_FILES)[number];

export interface GoldenSkill {
  filename: string;
  raw: string;
  parsed: SkillDoc;
}

export function loadGoldenSet(): GoldenSkill[] {
  return GOLDEN_FILES.map((filename) => {
    const raw = readFileSync(resolve(__dirname, filename), 'utf-8');
    return { filename, raw, parsed: parseSkill(raw) };
  });
}
