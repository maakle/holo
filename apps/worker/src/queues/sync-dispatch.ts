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
// - github-code-sync: branches on metadata.last_indexed_sha (per Part 5 plan).
// - everything else: branches on cursor presence.
export function decideSyncMode(args: { queue: QueueName; cursor: SyncCursor }): SyncMode {
  if (args.queue === 'github-code-sync') {
    const sha = args.cursor.metadata['last_indexed_sha'];
    return typeof sha === 'string' && sha.length > 0 ? 'code-incremental' : 'code-initial';
  }
  return args.cursor.exists ? 'incremental' : 'full';
}

export type SyncResult = {
  artifactCount: number;
  newCursor: Date | null;
  metadataPatch?: Record<string, unknown>;
};

export type SyncRunner = {
  full?(payload: SyncJobPayload): Promise<SyncResult>;
  incremental?(payload: SyncJobPayload, cursor: SyncCursor): Promise<SyncResult>;
  codeInitial?(payload: SyncJobPayload): Promise<SyncResult>;
  codeIncremental?(payload: SyncJobPayload, cursor: SyncCursor): Promise<SyncResult>;
};

export type RunSyncJobArgs = {
  queue: QueueName;
  jobId: string;
  payload: SyncJobPayload;
  runner: SyncRunner;
  cursorStore: SyncCursorStore;
  checkpointStore: CheckpointStore;
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
    run: () => invokeRunner(mode, args.runner, args.payload, cursor),
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
): Promise<SyncResult> {
  switch (mode) {
    case 'full':
      if (!runner.full) notImplemented('full');
      return runner.full(payload);
    case 'incremental':
      if (!runner.incremental) notImplemented('incremental');
      return runner.incremental(payload, cursor);
    case 'code-initial':
      if (!runner.codeInitial) notImplemented('codeInitial');
      return runner.codeInitial(payload);
    case 'code-incremental':
      if (!runner.codeIncremental) notImplemented('codeIncremental');
      return runner.codeIncremental(payload, cursor);
  }
}
