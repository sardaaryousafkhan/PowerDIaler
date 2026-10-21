# SaaS architecture

## Tenancy

- Shared database, row-level isolation via `organizationId`.
- Users join orgs through `Membership` (`ORG_OWNER` | `ORG_ADMIN` | `AGENT`).
- Platform `User.role` (`OWNER` / `ADMIN` / `USER`) remains for super-admin; day-to-day access uses org role + permissions.

## Auth

- Email/password company signup → Organization + ORG_OWNER membership.
- Google OAuth (`/auth/google`) when `GOOGLE_OAUTH_*` env vars are set.
- Invites: `POST /org/invites` → `/accept-invite?token=…`.
- JWT claims include `orgId`, `orgRole`, `membershipId`, `tokenVersion`.

## RBAC

Permission keys live in `@powerdialer/shared` (`packages/shared/src/permissions.ts`).

| Area | ORG_OWNER / ORG_ADMIN | AGENT (default) |
|------|------------------------|-----------------|
| Company settings, members, billing, integrations, DNC | yes | no |
| Campaign create/delete/import | yes | no |
| View campaigns | all org campaigns | assigned only |
| Dial / notes / start (if granted) | yes | assigned campaigns |

## Core dialer

Workers resolve `campaign.organizationId` for DNC, SMS rate, dedup, and integration preference. Jobs remain keyed by `campaignId`.
