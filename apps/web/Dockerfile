# Next.js multi-stage with standalone output (Next bundles its deps; we don't need pnpm at runtime).
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/web..."

FROM deps AS build
COPY apps/web apps/web/
RUN pnpm -F @holo/web build

FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/web/.next/standalone /repo
COPY --from=build /repo/apps/web/.next/static /repo/apps/web/.next/static
COPY --from=build /repo/apps/web/public /repo/apps/web/public 2>/dev/null || true
EXPOSE 3000
CMD ["node", "/repo/apps/web/server.js"]
