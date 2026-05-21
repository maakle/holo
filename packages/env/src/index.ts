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
  /**
   * Google Chat App (conversational bot) — distinct from the existing
   * read-only Chat ingestion connector. The shared Holo Chat App uses a
   * single service account whose JSON is provided here; per-org BYO apps
   * store their own credentials in `google_chat_app_configs`.
   *
   * GOOGLE_CHAT_APP_PROJECT_NUMBER is the Cloud project number (digits
   * only, from Cloud Console → Project Settings) used as the JWT audience
   * to validate inbound Chat events at /google-chat-app/events. Without
   * it the shared route fails closed (503). Named for what the operator
   * pastes; in code it plays the JWT `aud` role.
   *
   * GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON is the service account JSON used
   * to mint app-level tokens for outbound `messages.create` /
   * `messages.patch` calls. Multi-line; paste it raw (not base64'd) or
   * source from a secret store.
   */
  GOOGLE_CHAT_APP_PROJECT_NUMBER: z.string().optional(),
  GOOGLE_CHAT_APP_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // Linear uses per-user personal API keys (Settings → API → Personal API
  // keys). The token is collected through the wizard and stored in
  // connector_credentials — no global OAuth client to register.
  // Google Drive + Google Chat use per-org service accounts with
  // domain-wide delegation, not OAuth — there are no global client
  // credentials. The JSON key + impersonation email are collected per-org via
  // the wizard and stored in connector_service_accounts.
  // GitLab OAuth Application credentials. Register at
  // https://gitlab.com/-/profile/applications with redirect URI
  // `${WEB_PUBLIC_URL}/api/connectors/gitlab/callback` and scopes
  // `read_api`, `read_repository`, `read_user`. Optional so unrelated
  // dev environments don't have to register an app.
  GITLAB_CONNECTOR_CLIENT_ID: z.string().optional(),
  GITLAB_CONNECTOR_CLIENT_SECRET: z.string().optional(),
  // Salesforce Connected App OAuth credentials. Register at
  // Setup → App Manager → New Connected App with redirect URI
  // `${WEB_PUBLIC_URL}/api/connectors/salesforce/callback` and OAuth scopes
  // `api`, `refresh_token`, `offline_access`. Optional so unrelated dev
  // environments don't have to register a Connected App.
  SALESFORCE_CONNECTOR_CLIENT_ID: z.string().optional(),
  SALESFORCE_CONNECTOR_CLIENT_SECRET: z.string().optional(),
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
  /**
   * Wall-clock cap (ms) for the in-dashboard chat agent loop. Bound to the
   * web route's `maxDuration` minus a small safety margin so the orchestrator
   * surfaces a clean `HOLO_AGENT_WALLCLOCK` error instead of the platform
   * killing the request mid-stream.
   */
  HOLO_CHAT_WALL_CLOCK_MS: z.coerce.number().int().min(5_000).default(110_000),
  /**
   * Shared Holo Microsoft Teams bot — Microsoft App ID (GUID) from the
   * Azure AD app registration. Used as both the JWT audience for inbound
   * verification on the shared `/teams-bot/messages` route AND the
   * client_id for outbound token mint. Optional so unrelated dev
   * environments don't have to register an Azure bot.
   */
  TEAMS_BOT_APP_ID: z.string().optional(),
  /**
   * Shared Holo Microsoft Teams bot — client secret created in Azure
   * Portal → App registrations → Certificates & secrets. Paired with
   * `TEAMS_BOT_APP_ID` to mint outbound Bot Connector tokens via
   * the `client_credentials` grant.
   */
  TEAMS_BOT_APP_SECRET: z.string().optional(),
  /**
   * PostHog product analytics. All three are optional — when unset every
   * PostHog code path becomes a no-op and the apps boot identically to a
   * vanilla self-host. Disclosed to end users in the Privacy Policy.
   *
   * NEXT_PUBLIC_POSTHOG_KEY: browser project key (must be public-prefixed
   * to reach the client bundle). Disables client analytics when empty.
   *
   * NEXT_PUBLIC_POSTHOG_HOST: ingestion host. Defaults to the EU region
   * (https://eu.i.posthog.com); override for the US region or a
   * self-hosted PostHog instance.
   *
   * POSTHOG_API_KEY: server-side key used by posthog-node in the web
   * server runtime, gateway, and worker. May be the same string as the
   * public key — PostHog accepts either.
   */
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
  POSTHOG_API_KEY: z.string().optional(),
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
