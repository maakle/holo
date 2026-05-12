FROM node:20-alpine
# python3/make/g++ are needed to compile native node modules (e.g. tree-sitter)
# when no prebuilt binary is available for the target platform.
RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/gateway/package.json apps/gateway/
COPY packages packages/
RUN pnpm install --frozen-lockfile --filter "@holo/gateway..."

COPY apps/gateway apps/gateway/

ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "-F", "@holo/gateway", "start"]
