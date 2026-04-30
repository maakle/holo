# Single-stage tsx runtime — matches dev experience.
# Spec #2+ may switch to multi-stage with bundled output once the substrate hardens.
FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/api..."

COPY apps/api apps/api/

ENV NODE_ENV=production
EXPOSE 4000
CMD ["pnpm", "-F", "@holo/api", "start"]
