# Subscription plans — BMS Pro Trade Admin Panel

## Quick summary

| Concept | Where it lives |
|--------|----------------|
| **Plan catalog** | Firestore `subscription_plans` |
| **Per-tenant subscription state** | `businesses/{id}` + `users/{ownerUid}` |
| **Super admin manages plans** | `/dashboard/packages` → `/api/packages` |
| **Owner picks plan at signup** | `/onboard` step 3 → `/api/packages/public` |

Plans are seeded automatically from the legacy catalog on first API read if the collection is empty.

## URLs

| URL | Who | Purpose |
|-----|-----|---------|
| `/dashboard/packages` | Super admin | Create, edit, delete plans |
| `/dashboard/tenants` | Super admin | Onboard owners (includes plan step) |
| `/onboard` | Public | Self-signup with plan selection (`?planId=` supported) |

## API routes

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/packages` | Super admin | All plans (incl. inactive/hidden) |
| `POST` | `/api/packages` | Super admin | Create plan |
| `PUT` | `/api/packages` | Super admin | Update plan |
| `DELETE` | `/api/packages?id=` | Super admin | Delete plan |
| `GET` | `/api/packages/public` | None | Active, non-hidden plans for signup |

## Code map

- `lib/subscription-plans/` — types, helpers, Firestore server, default seeds
- `app/api/packages/` — super-admin CRUD + public list
- `components/packages-board.tsx` — packages UI
- `components/business-onboarding-form.tsx` — loads plans dynamically at step 3
- `lib/onboarding/server.ts` — writes plan limits + billing fields on tenant create

## Stripe (not yet wired)

This panel stores `stripePriceId` on each plan and `billing_status` on tenants. Stripe Checkout + webhooks can be added in a follow-up using the architecture from BMS Pro Black Admin Panel.
