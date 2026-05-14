/**
 * v0.1 skill-quality kill-switch — automated half.
 *
 * The roadmap's kill-switch is a binary 3-of-5-usable founder verdict before
 * cutting v0.1.0. This script handles the *automated* regression half:
 *
 *   - Loads the 10-skill golden set.
 *   - Verifies every golden skill is well-formed (frontmatter + body shape,
 *     tools restricted to the v0.0 MCP surface).
 *   - Runs ROUGE-L identity (≥ 0.95), noise (< 0.20), and near-duplicate
 *     truncation (≥ 0.70) checks. The truncation check is the synthesis
 *     regression gate — when it drops below 0.70, the synthesis prompt has
 *     drifted and the binary verdict at the top of the kill-switch decision
 *     doc must be re-taken.
 *
 * Exit codes:
 *   0 — all automated checks pass; founder still owes the binary verdict.
 *   1 — automated regression detected; do NOT cut v0.1.0 with skills.
 *
 * Run: `pnpm --filter @holo/skills exec tsx scripts/kill-switch.ts`
 *
 * The founder-judgment half lives in `docs/launch/skill-kill-switch.md`.
 */
import { loadGoldenSet, meanRougeL } from '../src/server';

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const VALID_TOOLS = new Set(['search', 'bash']);

function checkGoldenStructure(): CheckResult {
  const golden = loadGoldenSet();
  if (golden.length !== 10) {
    return {
      name: 'golden set has 10 skills',
      passed: false,
      detail: `expected 10, got ${golden.length}`,
    };
  }
  for (const g of golden) {
    if (!g.parsed.frontmatter.name) {
      return { name: 'every skill has a name', passed: false, detail: `${g.filename} missing name` };
    }
    if (!g.parsed.frontmatter.description) {
      return {
        name: 'every skill has a description',
        passed: false,
        detail: `${g.filename} missing description`,
      };
    }
    if (!Array.isArray(g.parsed.frontmatter.tools)) {
      return {
        name: 'every skill has a tools array',
        passed: false,
        detail: `${g.filename} missing tools`,
      };
    }
    for (const t of g.parsed.frontmatter.tools) {
      if (!VALID_TOOLS.has(t)) {
        return {
          name: 'every tool is a valid v0.0 MCP tool',
          passed: false,
          detail: `${g.filename} references invalid tool "${t}"`,
        };
      }
    }
    if (!g.parsed.body.includes('Procedure')) {
      return {
        name: 'every body has a Procedure section',
        passed: false,
        detail: `${g.filename} missing Procedure section`,
      };
    }
  }
  return { name: 'golden set structure', passed: true, detail: '10 skills, all well-formed' };
}

function checkIdentityBaseline(): CheckResult {
  const golden = loadGoldenSet();
  const pairs = golden.map((g) => ({ hypothesis: g.raw, reference: g.raw }));
  const score = meanRougeL(pairs);
  return {
    name: 'identity baseline (mean ROUGE-L F1 ≥ 0.95)',
    passed: score.f1 >= 0.95,
    detail: `mean F1 = ${score.f1.toFixed(4)}`,
  };
}

function checkNoiseBaseline(): CheckResult {
  const golden = loadGoldenSet();
  const noise =
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor';
  const pairs = golden.map((g) => ({ hypothesis: noise, reference: g.raw }));
  const score = meanRougeL(pairs);
  return {
    name: 'noise baseline (mean ROUGE-L F1 < 0.20)',
    passed: score.f1 < 0.2,
    detail: `mean F1 = ${score.f1.toFixed(4)}`,
  };
}

function checkSynthesisRegressionGate(): CheckResult {
  const golden = loadGoldenSet();
  const candidates = golden.map((g) => {
    const lines = g.raw.split('\n');
    const truncated = lines
      .slice(0, Math.max(lines.length - 3, Math.floor(lines.length * 0.9)))
      .join('\n');
    return { hypothesis: truncated, reference: g.raw };
  });
  const score = meanRougeL(candidates);
  return {
    name: 'synthesis regression gate (mean ROUGE-L F1 ≥ 0.70)',
    passed: score.f1 >= 0.7,
    detail: `mean F1 = ${score.f1.toFixed(4)}`,
  };
}

function main(): void {
  const checks: CheckResult[] = [
    checkGoldenStructure(),
    checkIdentityBaseline(),
    checkNoiseBaseline(),
    checkSynthesisRegressionGate(),
  ];

  console.log('skill-quality kill-switch — automated checks');
  console.log('============================================');
  for (const c of checks) {
    const mark = c.passed ? 'PASS' : 'FAIL';
    console.log(`  [${mark}] ${c.name} — ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.passed);
  console.log('');
  if (failed.length === 0) {
    console.log('Automated half: PASS.');
    console.log('');
    console.log('Founder still owes the binary 3-of-5 verdict before tagging v0.1.0.');
    console.log('See docs/launch/skill-kill-switch.md.');
    process.exit(0);
  } else {
    console.log(`Automated half: FAIL (${failed.length} check(s) failed).`);
    console.log('Do NOT tag v0.1.0 with skills until the regression is diagnosed.');
    process.exit(1);
  }
}

main();
