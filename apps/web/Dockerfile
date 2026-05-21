# Next.js multi-stage with standalone output (Next bundles its deps; we don't need pnpm at runtime).
FROM node:20-alpine AS base
# python3/make/g++ are needed to compile native node modules (e.g. tree-sitter)
# when no prebuilt binary is available for the target platform.
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/web..."

FROM deps AS build
COPY apps/web apps/web/
# Next.js inlines NEXT_PUBLIC_* into the client bundle at build time, so
# they must exist as env vars during `next build` — not just at runtime.
# Railway auto-forwards matching service variables as --build-arg when
# the Dockerfile declares them with ARG.
ARG NEXT_PUBLIC_POSTHOG_KEY
ARG NEXT_PUBLIC_POSTHOG_HOST
ARG NEXT_PUBLIC_HOLO_BILLING_ENABLED
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_HOLO_BILLING_ENABLED=$NEXT_PUBLIC_HOLO_BILLING_ENABLED
RUN echo "BUILD-CHECK POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY:+SET(${#NEXT_PUBLIC_POSTHOG_KEY}chars)}${NEXT_PUBLIC_POSTHOG_KEY:-UNSET} HOST=${NEXT_PUBLIC_POSTHOG_HOST:-UNSET} BILLING=${NEXT_PUBLIC_HOLO_BILLING_ENABLED:-UNSET}"
RUN pnpm -F @holo/web build
# Bundle the DB migration runner into a single self-contained file so the
# slim runtime image can run migrations as a Railway Pre-Deploy step
# without pulling in pnpm or workspace packages.
RUN npx --yes esbuild@0.24.0 packages/db/src/migrate.ts \
    --bundle --platform=node --target=node20 --format=cjs \
    --outfile=/repo/migrate.cjs

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone /repo
COPY --from=build /repo/apps/web/.next/static /repo/apps/web/.next/static
COPY --from=build /repo/apps/web/public /repo/apps/web/public
COPY --from=build /repo/migrate.cjs /repo/migrate.cjs
COPY --from=build /repo/packages/db/migrations /repo/migrations
EXPOSE 3000
CMD ["node", "/repo/apps/web/server.js"]
