# Deployment

## Services

| Service | Port | Notes |
|---------|------|--------|
| Web (Vite / static) | 5173 / 80 | Proxies `/api` to API |
| API | 4000 | Fastify |
| Worker | — | `pnpm worker` when not in `DEMO_MODE` |
| Postgres | 5432 | Production DB |
| Redis | 6379 | BullMQ (required outside DEMO_MODE) |
| Provider bridges | e.g. 5997 | RingCentral / others |

## Local demo (SQLite)

```bash
# apps/api/.env
DEMO_MODE=bridge   # or 1
DATABASE_URL=file:./dev.db
```

```bash
pnpm install
pnpm --filter @powerdialer/shared build
cd apps/api && pnpm exec prisma db push && pnpm exec tsx src/lib/backfillMultitenant.ts
pnpm demo   # or separate Terminal windows for api / web / bridge
```

## Production-shaped local (Docker Postgres + Redis)

```bash
docker compose up -d postgres redis
```

Point `apps/api/.env` at Postgres (change Prisma `provider` to `postgresql` in `schema.prisma` for production):

```
DATABASE_URL=postgresql://powerdialer:powerdialer@127.0.0.1:5432/powerdialer
REDIS_URL=redis://127.0.0.1:6379
DEMO_MODE=   # unset
AUTH_SECRET=<long-random>
SECRETS_MASTER_KEY=<long-random>
PUBLIC_BASE_URL=https://api.example.com
PUBLIC_WEB_URL=https://app.example.com
```

```bash
cd apps/api && pnpm exec prisma db push
pnpm --filter @powerdialer/api run worker   # separate process
pnpm --filter @powerdialer/api run start
pnpm --filter @powerdialer/web run build && serve apps/web/dist
```

## Google OAuth

```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:4000/auth/google/callback
PUBLIC_WEB_URL=http://127.0.0.1:5173
```

## Health

- `GET /health` → `{ ok: true }`
- Bridge health on its own port (e.g. `:5997/health`)
