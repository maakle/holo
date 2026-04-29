import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { initCrypto } from '@holo/crypto';
import { parseEnv } from '@holo/env';
import { AppModule } from './app.module';

async function bootstrap() {
  parseEnv(process.env);
  await initCrypto();

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(4000);
  console.log('apps/api listening on :4000');
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
