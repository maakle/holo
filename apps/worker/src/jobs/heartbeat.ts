import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Logger } from 'pino';

export const HEARTBEAT_QUEUE = 'heartbeat';
export const HEARTBEAT_INTERVAL_MS = 60_000;

export interface HeartbeatPayload {
  counter: number;
  ts: string;
}

export interface HeartbeatRegistry {
  connection: ConnectionOptions;
  logger: Logger;
  queues: Queue[];
  workers: Worker[];
}

let counter = 0;

/** For tests — exported so tests can reset between runs. */
export function _resetHeartbeatCounter(): void {
  counter = 0;
}

export async function processHeartbeat(): Promise<HeartbeatPayload> {
  counter += 1;
  return { counter, ts: new Date().toISOString() };
}

export async function registerHeartbeat(reg: HeartbeatRegistry): Promise<void> {
  const queue = new Queue(HEARTBEAT_QUEUE, { connection: reg.connection });
  reg.queues.push(queue);

  // Idempotent scheduler — replaces any existing repeatable with the same key.
  await queue.upsertJobScheduler(
    'heartbeat-tick',
    { every: HEARTBEAT_INTERVAL_MS },
    {
      name: 'tick',
      data: {},
      opts: { removeOnComplete: 100, removeOnFail: 100 },
    },
  );

  const worker = new Worker(
    HEARTBEAT_QUEUE,
    async () => {
      const payload = await processHeartbeat();
      reg.logger.info(payload, 'heartbeat tick');
      return payload;
    },
    { connection: reg.connection },
  );
  reg.workers.push(worker);
}
