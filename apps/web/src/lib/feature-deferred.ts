import { NextResponse } from 'next/server';

// Skills, marketplace, and procedure auto-discovery are deferred from the MVP.
// API surfaces return 501 with a stable shape so any clients/agents that still
// hold pre-deferral references get a clear signal instead of a 500.
//
// Re-enabling: restore the original route handlers from git history (see commits
// up to and including 38f49de on branch feat/procedure-auto-discovery). Supporting
// code in packages/skills/, packages/discovery/, and apps/web/src/lib/synthesize-and-persist.ts
// is intentionally retained so re-enabling does not require a re-architecture.
export function deferred(feature: string): NextResponse {
  return NextResponse.json(
    {
      code: 'HOLO_FEATURE_DEFERRED',
      problem: `${feature} is deferred from the MVP`,
      fix: 'Track progress in the README roadmap.',
    },
    { status: 501 },
  );
}
