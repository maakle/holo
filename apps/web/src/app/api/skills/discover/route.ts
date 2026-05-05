// Procedure auto-discovery deferred from the MVP. See README roadmap.
// Original implementation in git history; supporting logic in @holo/discovery.
import { deferred } from '@/lib/feature-deferred';

export const POST = () => deferred('procedure auto-discovery');
