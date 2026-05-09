import { holoError, ErrorCode } from '@holo/errors';
import { step, type CheckpointStore } from '../step';
import type { SyncCursor, SyncJobPayload, SyncMode, QueueName } from './types';
import type { SyncCursorStore } from './sync-cursor-store';

function notImplemented(method: string): never {
  throw holoError({
    code: ErrorCode.HOLO_CONNECTOR_NOT_IMPLEMENTED,
    problem: `SyncRunner.${method} not implemented`,
    fix: 'Provide a runner implementation via setSyncRunner() before enqueueing this job.',
  });
}

// Decides which sync entrypoint to call based on the cursor and queue.
// - github-code-sync / gitlab-code-sync: branches on metadata.last_indexed_sha
//   (per Part 5 plan). Both VCS code queues share the same shape.
// - everything else: branches on cursor presence.
export function decideSyncMode(args: { queue: QueueName; cursor: SyncCursor }): SyncMode {
  if (args.queue === 'github-code-sync' || args.queue === 'gitlab-code-sync') {
    const sha = args.cursor.metadata['last_indexed_sha'];
    return typeof sha === 'string' && sha.length > 0 ? 'code-incremental' : 'code-initial';
  }
  return args.cursor.exists ? 'incremental' : 'full';
}

export type SyncResult = {
  artifactCount: number;
  newCursor: Date | null;
  metadataPatch?: Record<string, unknown>;
  skipReason?: string;
  /**
   * Per-kind { new, deduped } counters from the framework runner. Optional
   * because the source_deleted skip path bails before any chunks are
   * considered, and we don't want to write a misleading empty breakdown
   * for runs that didn't actually run.
   */
  breakdown?: Record<string, { new: number; deduped: number }>;
};

// Heartbeat callback. The processor wires this to a debounced DB write so
// connectors can call it freely; runners that don't pass it through degrade
// to "no live progress" without breaking.
export type ReportProgressFn = (input: {
  current: number;
  total?: number | null;
  message?: string;
}) => void;

export type SyncRunnerOpts = {
  reportProgress?: ReportProgressFn;
  /** Cooperative cancellation; aborts when the user presses "Stop sync". */
  signal?: AbortSignal;
};

export type SyncRunner = {
  full?(payload: SyncJobPayload, opts?: SyncRunnerOpts): Promise<SyncResult>;
  incremental?(
    payload: SyncJobPayload,
    cursor: SyncCursor,
    opts?: SyncRunnerOpts,
  ): Promise<SyncResult>;
  codeInitial?(payload: SyncJobPayload, opts?: SyncRunnerOpts): Promise<SyncResult>;
  codeIncremental?(
    payload: SyncJobPayload,
    cursor: SyncCursor,
    opts?: SyncRunnerOpts,
  ): Promise<SyncResult>;
};

export type RunSyncJobArgs = {
  queue: QueueName;
  jobId: string;
  payload: SyncJobPayload;
  runner: SyncRunner;
  cursorStore: SyncCursorStore;
  checkpointStore: CheckpointStore;
  reportProgress?: ReportProgressFn;
  signal?: AbortSignal;
};

// Executes one sync job: read cursor → decide mode → invoke runner wrapped in
// step() so a partial sync resumes on retry → persist cursor.
export async function runSyncJob(args: RunSyncJobArgs): Promise<SyncResult> {
  const cursor = await args.cursorStore.read(args.payload.sourceId);
  const mode = decideSyncMode({ queue: args.queue, cursor });

  const result = await step({
    store: args.checkpointStore,
    sourceId: args.payload.sourceId,
    jobId: args.jobId,
    name: 'connector-sync',
    run: () =>
      invokeRunner(mode, args.runner, args.payload, cursor, {
        reportProgress: args.reportProgress,
        signal: args.signal,
      }),
  });

  await args.cursorStore.upsertAfterSync(args.payload.sourceId, {
    latestSeenTs: result.newCursor,
    status: 'ok',
    metadataPatch: result.metadataPatch,
  });

  return result;
}

async function invokeRunner(
  mode: SyncMode,
  runner: SyncRunner,
  payload: SyncJobPayload,
  cursor: SyncCursor,
  opts: SyncRunnerOpts,
): Promise<SyncResult> {
  switch (mode) {
    case 'full':
      if (!runner.full) notImplemented('full');
      return runner.full(payload, opts);
    case 'incremental':
      if (!runner.incremental) notImplemented('incremental');
      return runner.incremental(payload, cursor, opts);
    case 'code-initial':
      if (!runner.codeInitial) notImplemented('codeInitial');
      return runner.codeInitial(payload, opts);
    case 'code-incremental':
      if (!runner.codeIncremental) notImplemented('codeIncremental');
      return runner.codeIncremental(payload, cursor, opts);
  }
}
