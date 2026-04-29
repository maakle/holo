import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { MemexErrorFilter } from './errors/memex-error.filter';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
      },
    }),
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: MemexErrorFilter }],
})
export class AppModule {}
