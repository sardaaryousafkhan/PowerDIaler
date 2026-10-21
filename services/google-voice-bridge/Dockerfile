FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared ./packages/shared
COPY services/google-voice-bridge ./services/google-voice-bridge
RUN npm install -g pnpm@9.15.0 && pnpm install --filter @powerdialer/google-voice-bridge...
WORKDIR /app/services/google-voice-bridge
RUN pnpm exec prisma generate && pnpm run build

FROM node:20-alpine
WORKDIR /app/services/google-voice-bridge
ENV NODE_ENV=production
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages /app/packages
COPY --from=build /app/services/google-voice-bridge ./
EXPOSE 5998
CMD sh -c "npx --no-install prisma db push --accept-data-loss --skip-generate && node dist/server.js"
