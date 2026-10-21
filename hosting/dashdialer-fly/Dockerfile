# DashDialer hosted web app (UI + API) — built on Fly remote builders (no local Docker needed).
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/providers/package.json packages/providers/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @powerdialer/shared --filter @powerdialer/providers run build \
  && pnpm --filter @powerdialer/web run build \
  && cd apps/api && pnpm exec prisma generate

RUN chmod +x hosting/dashdialer-fly/start.sh

ENV HOSTED_ROOT=/app
ENV DEMO_MODE=1
ENV NODE_ENV=production
ENV PORT=4000
ENV GATEWAY_PORT=8080
ENV HOST=127.0.0.1
ENV DATABASE_URL=file:/data/dashdialer.db

EXPOSE 8080
VOLUME ["/data"]

CMD ["hosting/dashdialer-fly/start.sh"]
