FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY services/zoom-phone-bridge ./services/zoom-phone-bridge
RUN npm install -g pnpm@9.15.0 && pnpm install --filter @powerdialer/zoom-phone-bridge...
WORKDIR /app/services/zoom-phone-bridge
RUN pnpm exec prisma generate && pnpm run build

FROM node:20-alpine
WORKDIR /app/services/zoom-phone-bridge
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/zoom-phone-bridge ./
EXPOSE 5999
# Apply Prisma schema on every container boot so a fresh SQLite mount (or a
# brand-new Postgres database) is usable immediately.
CMD sh -c "npx --no-install prisma db push --accept-data-loss --skip-generate && node dist/server.js"
