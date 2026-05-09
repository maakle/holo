import { z } from 'zod';
import { holoError, ErrorCode } from '@holo/errors';

const EnvSchema = z.object({
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  HOLO_TOKEN_ENCRYPTION_KEY: z.string().min(40),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  /**
   * Comma-separated list of additional origins Better Auth should trust for
   * sign-in cookies and CSRF — beyond `BETTER_AUTH_URL` which is always
   * trusted. Use this in dev when you access the app over both
   * `http://localhost:3000` and an ngrok / preview tunnel URL.
   *
   * Example: `AUTH_TRUSTED_ORIGINS=http://localhost:3000,https://abc.ngrok.dev`
   */
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  GITHUB_LOGIN_CLIENT_ID: z.string().min(1),
  GITHUB_LOGIN_CLIENT_SECRET: z.string().min(1),
  // GitHub App credentials replace the OAuth-app connector flow.
  // Required for the connector to function; optional only so tests
  // and unrelated dev environments don't have to register an App.
  GITHUB_APP_ID: z.string().min(1).optional(),
  GITHUB_APP_SLUG: z.string().min(1).optional(),
  GITHUB_APP_PRIVATE_KEY_B64: z.string().min(40).optional(),
  GITHUB_APP_WEBHOOK_SECRET: z.string().min(16).optional(),
  SLACK_CONNECTOR_CLIENT_ID: z.string().optional(),
  SLACK_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  /**
   * Slack signing secret — Basic Information → App Credentials at api.slack.com.
   * Required to verify event payloads and slash command requests on the
   * gateway. If absent, the bot endpoints reject all incoming requests so a
   * misconfigured deploy never silently processes unsigned input.
   */
  SLACK_CONNECTOR_SIGNING_SECRET: z.string().optional(),
  LINEAR_CONNECTOR_CLIENT_ID: z.string().optional(),
  LINEAR_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  GOOGLEDRIVE_CONNECTOR_CLIENT_ID: z.string().optional(),
  GOOGLEDRIVE_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  // GitLab OAuth Application credentials. Register at
  // https://gitlab.com/-/profile/applications with redirect URI
  // `${WEB_PUBLIC_URL}/api/connectors/gitlab/callback` and scopes
  // `read_api`, `read_repository`, `read_user`. Optional so unrelated
  // dev environments don't have to register an app.
  GITLAB_CONNECTOR_CLIENT_ID: z.string().optional(),
  GITLAB_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  /**
   * Google Cloud OAuth client used by the Google Chat connector.
   * Same client (Web application type) consented for the Chat scopes
   * (chat.spaces.readonly + chat.messages.readonly).
   */
  GOOGLE_CHAT_CONNECTOR_CLIENT_ID: z.string().optional(),
  GOOGLE_CHAT_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().optional(),
  /**
   * RFC 5322 sender for outbound emails (e.g. invitations, OTPs).
   * Examples: `"Holo <noreply@example.com>"` or just `"noreply@example.com"`.
   * The local part / display name is up to you; the domain MUST be verified
   * in Resend. Required when `EMAIL_PROVIDER=resend`. Earlier we derived this
   * from `BETTER_AUTH_URL`, which silently broke in dev (localhost is not a
   * verified domain) — failures got swallowed by better-auth's background
   * task wrapper, so the invite endpoint returned 200 while no email shipped.
   */
  EMAIL_FROM: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MCP_PUBLIC_URL: z.url().default('http://localhost:8080'),
  WEB_PUBLIC_URL: z.url().optional(),
  MCP_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /**
   * Days to retain agent_events (mcp_invocations) before the worker's
   * retention job prunes them. Set to 0 to disable retention.
   */
  OBSERVABILITY_TTL_DAYS: z.coerce.number().int().min(0).default(30),
}).refine(
  (env) =>
    env.EMAIL_PROVIDER !== 'resend' ||
    (!!env.RESEND_API_KEY && !!env.EMAIL_FROM),
  {
    message:
      'EMAIL_PROVIDER=resend requires RESEND_API_KEY and EMAIL_FROM (e.g. "Holo <noreply@your-verified-domain.com>")',
    path: ['EMAIL_PROVIDER'],
  },
);

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
