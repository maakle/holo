FROM node:20-alpine
RUN apk add --no-cache git
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/worker..."

COPY apps/worker apps/worker/

ENV NODE_ENV=production
CMD ["pnpm", "-F", "@holo/worker", "start"]
