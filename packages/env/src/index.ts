import { z } from 'zod';
import { holoError, ErrorCode } from '@holo/errors';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  HOLO_TOKEN_ENCRYPTION_KEY: z.string().min(40),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  GITHUB_LOGIN_CLIENT_ID: z.string().min(1),
  GITHUB_LOGIN_CLIENT_SECRET: z.string().min(1),
  GITHUB_CONNECTOR_CLIENT_ID: z.string().min(1),
  GITHUB_CONNECTOR_CLIENT_SECRET: z.string().min(1),
  SLACK_CONNECTOR_CLIENT_ID: z.string().optional(),
  SLACK_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  GRAIN_CONNECTOR_CLIENT_ID: z.string().optional(),
  GRAIN_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw holoError({
      code: ErrorCode.HOLO_ENV_INVALID,
      problem: 'environment variables are missing or invalid',
      cause: issues,
      fix: 'Verify your .env file matches .env.example. Generate secrets with `openssl rand -base64 32`.',
    });
  }
  return result.data;
}
