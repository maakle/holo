#!/usr/bin/env node
// Manual smoke test for the single-origin gateway rewrite.
// Prereq: web + gateway running locally (pnpm dev).
//
// What this verifies:
//   1. GET http://localhost:3000/v1/health     → 200, JSON, came from gateway
//   2. GET http://localhost:3000/openapi.json  → 200, JSON, has paths
//   3. POST http://localhost:3000/mcp           → 401 (expected; no bearer)
//      and the WWW-Authenticate header points at the single-origin URL,
//      not http://localhost:8080.
//
// Pass = all checks green. Doesn't verify a full MCP session — see Task 9
// for the Claude Desktop end-to-end procedure.
const BASE = (process.env.WEB_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

let failed = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  else { console.log(`  \x1b[31m✗\x1b[0m ${name}  ${detail}`); failed++; }
}

console.log(`Verifying single-origin gateway at ${BASE}\n`);

try {
  // 1. /v1/health
  {
    const r = await fetch(`${BASE}/v1/health`);
    const body = await r.json().catch(() => null);
    check('GET /v1/health returns 200', r.status === 200, `status=${r.status}`);
    check('GET /v1/health body is JSON', body !== null);
  }

  // 2. /openapi.json
  {
    const r = await fetch(`${BASE}/openapi.json`);
    const body = await r.json().catch(() => null);
    check('GET /openapi.json returns 200', r.status === 200, `status=${r.status}`);
    check('GET /openapi.json has paths', body && typeof body.paths === 'object');
  }

  // 3. /mcp 401 + correct WWW-Authenticate
  {
    const r = await fetch(`${BASE}/mcp`, { method: 'POST' });
    check('POST /mcp returns 401 (no bearer)', r.status === 401, `status=${r.status}`);
    const wwwAuth = r.headers.get('www-authenticate') || '';
    check(
      'WWW-Authenticate points at single-origin host',
      wwwAuth.includes(BASE) && !wwwAuth.includes('localhost:8080'),
      `header=${wwwAuth || '(missing)'}`,
    );
  }
} catch (e) {
  console.error(`\n\x1b[31mNetwork error:\x1b[0m ${e.message}`);
  console.error(`Is the dev server running at ${BASE}? Try \`pnpm dev\` in another terminal.`);
  process.exit(1);
}

console.log('');
if (failed) { console.error(`\x1b[31m${failed} check(s) failed\x1b[0m`); process.exit(1); }
console.log('\x1b[32mAll checks passed.\x1b[0m');
