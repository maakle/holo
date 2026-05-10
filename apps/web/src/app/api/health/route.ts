import { NextResponse } from 'next/server';

// Liveness probe for Railway (railway.toml#holo-web → healthcheckPath).
// Intentionally bare — no DB or external dependency check. Railway runs
// this during deploys before downstream services may be reachable; a
// dependency-aware probe would fail spurious deploys. If we ever need a
// readiness probe (DB, redis, queues), add it as a separate /api/ready
// route and configure that path on the readiness check, not this one.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ status: 'ok' });
}
