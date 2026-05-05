// Skill synthesis deferred from the MVP. See README roadmap.
// The synthesis logic itself lives in apps/web/src/lib/synthesize-and-persist.ts
// and packages/skills/, retained for re-enablement.
import { deferred } from '@/lib/feature-deferred';

export const POST = () => deferred('skill synthesis');
