FROM node:20-alpine
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/mcp/package.json apps/mcp/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/mcp..."

COPY apps/mcp apps/mcp/

ENV NODE_ENV=production
EXPOSE 8091
CMD ["pnpm", "-F", "@holo/mcp", "start"]
