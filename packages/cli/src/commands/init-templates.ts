/**
 * Static templates bundled with `holo init`. Inlined as strings rather than
 * read from disk so that the published `@holo/cli` npm package doesn't need
 * to ship adjacent .yml/.txt files; the bundler/tsc output stays self-
 * contained.
 *
 * The compose template below pulls pre-built images from GHCR rather than
 * building from local source — `holo init` is meant to work in an empty
 * directory without a clone of the repo. The repo-root `docker-compose.yml`
 * still uses `build: context: .` for in-monorepo dev. Image tag tracks the
 * CLI's own version so a `npx @holo/cli@0.3.0 init` pins the matching
 * server images.
 */

const IMAGE_REPO = 'ghcr.io/maakle';
const IMAGE_TAG = 'latest';

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
    image: ${IMAGE_REPO}/holo-worker:${IMAGE_TAG}
    command: ["pnpm", "-F", "@holo/db", "migrate"]
    environment:
      DATABASE_URL: postgresql://\${POSTGRES_USER:-holo}:\${POSTGRES_PASSWORD}@postgres:5432/\${POSTGRES_DB:-holo}
    depends_on:
      postgres: { condition: service_healthy }

  worker:
    image: ${IMAGE_REPO}/holo-worker:${IMAGE_TAG}
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
    image: ${IMAGE_REPO}/holo-gateway:${IMAGE_TAG}
    environment: *app_env
    ports:
      - "8080:8080"
    depends_on:
      migrate: { condition: service_completed_successfully }

  web:
    image: ${IMAGE_REPO}/holo-web:${IMAGE_TAG}
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
