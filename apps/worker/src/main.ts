import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { parseEnv } from '@holo/env';
import { initCrypto } from '@holo/crypto';
import { createOpenAiEmbedder, createVoyageEmbedder } from '@holo/embedder';
import { holoError, ErrorCode } from '@holo/errors';
import { AppModule } from './app.module';
import { setEmbedderClient } from './queues/embed';
import { setBackfillEmbedderClient } from './queues/embed-backfill';
import { getWorkerPosthog } from './posthog';
import type { EmbedderClient } from './queues/embed-runner';
import type { EmbeddingModel } from './queues/embed-insert';

/**
 * Build the EmbedderClient adapter the worker expects. We need a single
 * object that dispatches `embedBatch(model, texts)` to the right vendor
 * SDK — github-code chunks go to Voyage, everything else to OpenAI.
 *
 * Voyage is optional: if VOYAGE_API_KEY is unset, we fall back to OpenAI
 * for github-code too. That keeps the bootstrap green for solo developers
 * who haven't signed up for Voyage.
 */
function buildEmbedderClient(): EmbedderClient {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'OPENAI_API_KEY is required for the embed worker',
      fix: 'Set OPENAI_API_KEY in your .env. Embeddings cannot run without it.',
    });
  }
  const openai = createOpenAiEmbedder({ apiKey: openaiKey });
  const voyageKey = process.env.VOYAGE_API_KEY;
  const voyage = voyageKey ? createVoyageEmbedder({ apiKey: voyageKey }) : null;

  return {
    async embedBatch(model: EmbeddingModel, texts: string[]): Promise<number[][]> {
      if (model === 'voyage-code-3') {
        return voyage ? voyage.embed(texts) : openai.embed(texts);
      }
      return openai.embed(texts);
    },
  };
}

async function bootstrap() {
  const env = parseEnv(process.env);
  if (!env.ANTHROPIC_API_KEY) {
    // Required for the Slack bot agent. Fail fast rather than returning
    // "Something went wrong" to every Slack mention.
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'ANTHROPIC_API_KEY is required for the worker',
      fix: 'Set ANTHROPIC_API_KEY in your .env. The Slack bot agent cannot run without it.',
    });
  }
  await initCrypto();
  const embedder = buildEmbedderClient();
  setEmbedderClient(embedder);
  setBackfillEmbedderClient(embedder);
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
    logger: ['error', 'warn'],
  });
  app.useLogger(app.get(Logger));
  console.log('apps/worker started; heartbeat scheduled every 60s');

  // Flush queued PostHog events before exit. No-op when PostHog isn't
  // configured.
  const shutdown = async (signal: string) => {
    console.log(`worker shutting down (${signal})`);
    try {
      await getWorkerPosthog().shutdown();
    } catch (err) {
      console.error('posthog shutdown failed', err);
    }
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await new Promise(() => {});
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
