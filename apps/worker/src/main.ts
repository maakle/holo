import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { parseEnv } from '@holo/env';
import { AppModule } from './app.module';

async function bootstrap() {
  parseEnv(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
    logger: ['error', 'warn'],
  });
  app.useLogger(app.get(Logger));
  console.log('apps/worker started; heartbeat scheduled every 60s');
  await new Promise(() => {});
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
