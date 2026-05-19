import { getQueueByName } from '@/lib/sync-queue';
import { withActiveOrg } from '@/lib/with-active-org';

// Lightweight poll endpoint for the file explorer's "processing" banner and
// the manual-upload manage sheet's per-session indicator. Reads BullMQ
// directly — the embed queue is the bottleneck that gates files showing up
// in the explorer (artifacts + chunks are only written when the worker
// finishes the embed job), so its depth is what the UI needs to surface.
//
// Scope is org-wide because the banner sits on /files and applies to every
// connector, not just manual upload. Per-source breakdown lets the manage
// sheet attribute the work to specific upload sessions.

export type EmbedStatusResponse = {
  pendingJobs: number;
  pendingChunks: number;
  bySource: Record<string, { pendingJobs: number; pendingChunks: number }>;
};

interface EmbedJobData {
  chunks?: Array<{ sourceId?: string }>;
  organizationId?: string;
}

export const GET = withActiveOrg(async ({ orgId }) => {
  const queue = getQueueByName('embed');
  // Cap at 1000 to keep the scan bounded under load. If the queue is deeper
  // than that for a single org the banner saturates at "many" and that's the
  // honest signal anyway.
  const jobs = await queue.getJobs(['waiting', 'active'], 0, 1000, false);

  let pendingJobs = 0;
  let pendingChunks = 0;
  const bySource: Record<string, { pendingJobs: number; pendingChunks: number }> = {};

  for (const j of jobs) {
    const data = j.data as EmbedJobData | undefined;
    if (data?.organizationId !== orgId) continue;
    const chunkCount = data.chunks?.length ?? 0;
    pendingJobs += 1;
    pendingChunks += chunkCount;
    const sourceId = data.chunks?.[0]?.sourceId;
    if (sourceId) {
      const acc = bySource[sourceId] ?? { pendingJobs: 0, pendingChunks: 0 };
      acc.pendingJobs += 1;
      acc.pendingChunks += chunkCount;
      bySource[sourceId] = acc;
    }
  }

  return { pendingJobs, pendingChunks, bySource } satisfies EmbedStatusResponse;
});
