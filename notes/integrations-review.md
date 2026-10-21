# Integrations — audit log (errors & bugs)

Last full pass: **2026-04-21** (code + UX review).

---

## Fixed in code during this audit

| # | Issue | What went wrong | Fix |
|---|--------|------------------|-----|
| 1 | **Auto-repair PUT failure showed scary red text** | Same repair flow: when `PUT` failed, `setErr` drove the **red paragraph** under the intro even though the catalog had loaded — felt like a broken page. | **Removed persistent red** for this case; use **`pushToast` warning** only. Red is reserved for **blocking load failure** (cannot reach `/integrations` at all). |
| 2 | **Race on first `GET /integrations` (singleton row)** | Two parallel first loads could both `create` the same `id = "default"` row → possible **unique constraint** error on one request. | Wrapped `create` in **try/catch** and re-`findUnique`; if still missing, throw a clear error (HTTP 500). |
| 3 | **Light mode contrast on Integrations page** | Integration cards used **dark gradients** (`rgba(18, 22, 32, …)`) and light-on-dark tagline colors; on a **white** background they looked muddy or low-contrast. | Added **`html[data-theme="light"]`** and **`@media (prefers-color-scheme: light)`** overrides for `.integration-card*`, badges, tagline, caps, link hover, and **`.activity-strip`**. |
| 4 | (Earlier) **GET wrote to DB unnecessarily** | `upsert` with empty `update` on every read. | Replaced with **find + create if missing** (see earlier commit). |
| 5 | (Earlier) **Stale catalog key in DB** | Saved vendor id not in current catalog. | **`GET /integrations`** now **normalizes** the row with `coerceIntegrationProviderId` and persists when needed; no client repair `PUT`. |
| 6 | **Load effect + repair churn** | `useEffect` depended on `pushToast` → extra reloads; repair `PUT` could fail and still confuse operators. | **Mount-only load** (`[]` + documented eslint exception); **removed** client-side repair `PUT`. |
| 7 | **API unreachable** | Full-page red error when `GET` failed. | **Retries** (4 attempts, backoff); then **bundled** `integrationsCatalog` from `@powerdialer/shared`, **localStorage** key `pd_integration_pref_v1`, **offline banner**, Save writes locally until API returns. |

---

## Remaining risks / edge cases (not fixed or acceptable)

| # | Topic | Notes |
|---|--------|--------|
| A | **React StrictMode (dev)** | Mount-only load still runs twice in dev; retries are cheap and idempotent. |
| B | **No click-outside on theme / menus** | Unrelated to integrations API; if the theme menu overlaps integrations, use Escape or click a pill. |
| C | **Single global preference** | One row `IntegrationPreference.id = "default"` for the whole app — no per-user or per-tenant split. By design until multi-tenant exists. |
| D | **Preference does not change telephony** | Twilio (or demo providers) still handle traffic. The screen is **roadmap / priority** only; documented in UI copy. |

---

## API contract (for debugging)

- **`GET /integrations`** — `{ catalog, preference }`. Creates the singleton row if missing.
- **`PUT /integrations/preference`** — body `{ preferredIntegrationKey }` must match **Zod** `integrationProviderIdSchema` (same ids as `integrationsCatalog`).

Typical failures from the UI:

- **Network / API down** — after retries, page shows **bundled catalog** + **offline mode**; preference can still be changed and **saved to localStorage** until the API is back.
- **400 on PUT** — invalid key (should not happen from UI if catalog and form stay in sync); message is JSON from `handle()`.

---

## Optional follow-ups

- E2E tests: invalid key repair, concurrent first GET, PUT validation error.
- Close integration card menu / dismiss toasts with Escape (global handler).
- Custom initials for vendors like **8x8** instead of algorithmic first letters.
