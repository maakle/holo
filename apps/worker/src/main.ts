import pino from 'pino';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { parseEnv } from '@holo/env';
import { registerHeartbeat } from './jobs/heartbeat';

function parseRedisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    // BullMQ expects no maxRetriesPerRequest on the IORedis instance.
    maxRetriesPerRequest: null,
  };
}

async function main() {
  const env = parseEnv(process.env);
  const logger = pino({
    transport: env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
  });
  const connection = parseRedisConnection(env.REDIS_URL);

  const queues: Queue[] = [];
  const workers: Worker[] = [];

  // Heartbeat — proves the worker process is alive and BullMQ is wired.
  await registerHeartbeat({ connection, logger, queues, workers });

  // Future job registrations (ingestion per connector) plug in here.

  logger.info(
    { queues: queues.map((q) => q.name) },
    'apps/worker started; BullMQ workers active',
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(queues.map((q) => q.close()));
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
