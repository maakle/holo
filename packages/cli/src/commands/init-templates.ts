/**
 * Static templates bundled with `holo init`. Inlined as strings rather than
 * read from disk so that the published `@holo/cli` npm package doesn't need
 * to ship adjacent .yml/.txt files; the bundler/tsc output stays self-
 * contained.
 *
 * If `docker-compose.yml` here drifts from the repo root file, that is OK
 * for now — `holo init` is the OSS-quickstart entry point, not the dev
 * compose used inside this monorepo. The repo-root file builds images
 * from local source; the version below is identical today (so an in-repo
 * `holo init` matches the dev workflow). When GHCR images publish on tag
 * we'll fork this template to use `image:` instead of `build:`.
 */

export const DOCKER_COMPOSE_TEMPLATE = `services:
  postgres:
    image: pgvector/pgvector:pg16
    # Localhost-only dev DB. All credentials come from .env.
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-holo}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?required}
      POSTGRES_DB: \${POSTGRES_DB:-holo}
    ports:
      - "5436:5432"
    volumes:
      - holo_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-holo}"]
      interval: 5s
      timeout: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6382:6379"
    volumes:
      - holo_redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  migrate:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    command: ["pnpm", "-F", "@holo/db", "migrate"]
    environment:
      DATABASE_URL: postgresql://\${POSTGRES_USER:-holo}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-holo}
    depends_on:
      postgres: { condition: service_healthy }

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment: &app_env
      DATABASE_URL: postgresql://\${POSTGRES_USER:-holo}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-holo}
      REDIS_URL: redis://redis:6379
      HOLO_TOKEN_ENCRYPTION_KEY: \${HOLO_TOKEN_ENCRYPTION_KEY}
      BETTER_AUTH_SECRET: \${BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: \${BETTER_AUTH_URL:-http://localhost:3000}
      GITHUB_LOGIN_CLIENT_ID: \${GITHUB_LOGIN_CLIENT_ID}
      GITHUB_LOGIN_CLIENT_SECRET: \${GITHUB_LOGIN_CLIENT_SECRET}
      GITHUB_CONNECTOR_CLIENT_ID: \${GITHUB_CONNECTOR_CLIENT_ID}
      GITHUB_CONNECTOR_CLIENT_SECRET: \${GITHUB_CONNECTOR_CLIENT_SECRET}
      HOLO_TELEMETRY_INSTALL_ID: \${HOLO_TELEMETRY_INSTALL_ID:-}
      HOLO_TELEMETRY_STARTED_AT: \${HOLO_TELEMETRY_STARTED_AT:-}
      HOLO_TELEMETRY_OPT_IN: \${HOLO_TELEMETRY_OPT_IN:-false}
      EMAIL_PROVIDER: \${EMAIL_PROVIDER:-console}
      RESEND_API_KEY: \${RESEND_API_KEY:-}
      NODE_ENV: production
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }

  gateway:
    build:
      context: .
      dockerfile: apps/gateway/Dockerfile
    environment: *app_env
    ports:
      - "8080:8080"
    depends_on:
      migrate: { condition: service_completed_successfully }

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment: *app_env
    ports:
      - "3000:3000"
    depends_on:
      migrate: { condition: service_completed_successfully }

volumes:
  holo_pg_data:
  holo_redis_data:
`;

export const TELEMETRY_PRIVACY_NOTICE = `
holo collects opt-in time-to-hello-world (TTHW) telemetry to track how long
the quickstart actually takes for new installs. We use the aggregate p50/p95
to report install-time honestly on the docs site.

What is sent (only if you opt in):
  - An anonymous install ID (random UUID, generated locally)
  - The 'init started' timestamp
  - The 'first MCP search succeeded' timestamp

What is NOT sent: any of your data, secrets, env vars, IPs, hostnames,
project paths, connector contents, or anything that could identify you or
your org.

You can change this later by editing HOLO_TELEMETRY_OPT_IN in .env.
`;
