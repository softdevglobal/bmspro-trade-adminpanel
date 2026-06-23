# Subscription & billing — BMS Pro Trade Admin Panel

Overview of **subscription plans**, **bundled SMS**, **SMS top-ups**, and **Stripe Checkout**.

## Quick summary

| Concept | Where it lives |
|--------|----------------|
| **Plan catalog** | Firestore `subscription_plans` |
| **SMS add-on catalog** | Firestore `sms_packages` |
| **Per-tenant subscription state** | `businesses/{id}` + `users/{ownerUid}` |
| **Per-tenant SMS balance** | `businesses` — `smsMessageLimit`, `smsMessagesUsed`, `smsBundleQuota`, etc. |
| **Stripe checkout fulfillment ledger** | Firestore `stripe_fulfilled_sessions` |
| **Super admin manages plans** | `/dashboard/packages` → `/api/packages` |
| **Super admin manages SMS packages** | `/dashboard/sms-packages` → `/api/sms-packages` |
| **Owner subscription & billing** | `/dashboard/subscription` |
| **Owner SMS top-up** | `/dashboard/sms` |
| **Owner picks plan at signup** | `/onboard` step 3 → `/api/packages/public` |

Plans and SMS packages are seeded from defaults on first API read if their collections are empty.

Each subscription plan can reference `smsPackageId` to **bundle SMS quota** that renews with the subscription billing period.

---

## URLs

| URL | Who | Purpose |
|-----|-----|---------|
| `/dashboard/packages` | Super admin | Create, edit, delete plans; link to Stripe |
| `/dashboard/sms-packages` | Super admin | Create, edit SMS packages; link to Stripe |
| `/dashboard/subscription` | Business owner | Trial/renewal banner, staff usage, bundled SMS, upgrade/downgrade |
| `/dashboard/sms` | Business owner | SMS balance and one-time top-up packages |
| `/dashboard/tenants` | Super admin | Onboard owners (includes plan step) |
| `/onboard` | Public | Self-signup with plan selection (`?planId=` supported) |

### Owner subscription page (`/dashboard/subscription`)

- **Free trial banner** — days remaining, progress bar, trial end date, **Add Payment Details**
- **Active subscription banner** — renewal countdown, staff usage, **bundled SMS** balance and renew date
- **Payment required** — when no Stripe subscription exists and billing is pending
- **Available plans** — card grid (same style as SMS top-up cards); upgrade/downgrade via Stripe Checkout
- **Downgrade guard** — blocked when active staff count exceeds the target plan limit

### Owner SMS page (`/dashboard/sms`)

- Current SMS balance and low-balance warning
- Top-up packages with price on the **Top up package** button (Stripe Checkout when enabled)

---

## API routes — subscription plans

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/packages` | Super admin | All plans (incl. inactive/hidden) + tenant counts |
| `POST` | `/api/packages` | Super admin | Create plan (auto-links Stripe recurring price when configured) |
| `PUT` | `/api/packages` | Super admin | Update plan |
| `DELETE` | `/api/packages?id=` | Super admin | Delete plan |
| `GET` | `/api/packages/public` | None | Active, non-hidden plans for signup |
| `POST` | `/api/packages/sync-stripe` | Super admin | Create/refresh Stripe product + recurring price for one plan |

## API routes — owner subscription

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/business/subscription` | Business owner | Snapshot (trial, renewal, bundled SMS, staff) + available plans |
| `POST` | `/api/business/subscription` | Business owner | Change plan without Stripe (dev only, when `STRIPE_SECRET_KEY` unset) |

`GET /api/business/subscription` returns:

- `subscription` — `TenantSubscriptionSnapshot` (plan, trial, billing, SMS bundle, staff counts)
- `plans` — `AvailablePlanOption[]` with `direction`, `changeAllowed`, `blockReason`, `bundledSmsPackage`
- `stripeEnabled` — whether server Stripe is configured

## API routes — SMS packages

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/sms-packages` | Super admin | All SMS packages + tenant counts |
| `POST` | `/api/sms-packages` | Super admin | Create package (auto-links to Stripe if configured) |
| `PUT` | `/api/sms-packages` | Super admin | Update package |
| `DELETE` | `/api/sms-packages?id=` | Super admin | Delete package |
| `POST` | `/api/sms-packages/sync-stripe` | Super admin | Create/refresh Stripe product + one-time price |
| `GET` | `/api/business/sms` | Business owner | SMS balance + available top-up packages |
| `POST` | `/api/business/sms` | Business owner | Legacy free top-up (disabled when Stripe is configured) |

---

## Bundled SMS vs top-up SMS

| Type | Source | Renews? | Payment |
|------|--------|---------|---------|
| **Bundled** | Plan `smsPackageId` → granted at onboarding and on plan change/renewal | Yes, with subscription period | Included in plan price |
| **Top-up** | Owner buys from `/dashboard/sms` | No — adds to current limit | One-time Stripe Checkout |

On subscription **renewal** or **plan change**, `buildTenantSmsRenewalFields()` re-grants the plan’s bundled quota while preserving any purchased top-up balance above the previous bundle allowance.

---

## Code map

**Subscription plans**

- `lib/subscription-plans/` — types, helpers, Firestore server, default seeds
- `lib/subscription-plans/tenant-subscription.ts` — snapshot, staff limits, plan change validation, `applyPlanChangeToTenant`
- `lib/subscription-plans/tenant-types.ts` — client-safe snapshot and plan option types
- `lib/subscription-plans/server.ts` — `renewTenantSubscription()`, `buildTenantSubscriptionFields()`
- `app/api/packages/` — super-admin CRUD, public list, Stripe sync
- `components/packages-board.tsx` — admin plans UI (Stripe badges, **Add to Stripe**)
- `components/package-build-modal.tsx` — plan editor (optional `stripePriceId`, bundled SMS)
- `components/owner-subscription-board.tsx` — owner trial/renewal UI and plan cards
- `app/dashboard/subscription/page.tsx` — owner subscription page

**SMS packages**

- `lib/sms-packages/` — types, helpers, balance, Firestore server, default seeds
- `app/api/sms-packages/` — super-admin CRUD + Stripe sync
- `components/sms-packages-board.tsx` — SMS catalog UI
- `components/sms-package-build-modal.tsx` — package editor
- `components/owner-sms-board.tsx` — owner top-up UI

**Onboarding & tenant state**

- `components/business-onboarding-form.tsx` — plan selection; redirects to Stripe after signup when enabled
- `lib/onboarding/server.ts` — writes plan limits, trial fields, billing fields, and bundled SMS on tenant create

**Stripe**

- `lib/stripe/` — checkout, billing, fulfill, subscription/SMS price sync
- `lib/stripe/fulfill.ts` — `confirmCheckoutSessionForBusiness()`, `stripe_fulfilled_sessions` idempotency + purchase log writes
- `lib/stripe/subscription-plan-prices.ts` — auto-create recurring Stripe product + price for plans
- `lib/stripe/sms-package-prices.ts` — auto-create one-time Stripe product + price for SMS packages
- `lib/catalog/tenant-package-usage.ts` — reads `stripe_fulfilled_sessions` for super-admin purchase history

---

## Stripe

Full setup guide: **`lib/stripe/README.md`**

No webhook secret is required. After Checkout, Stripe redirects back and the app confirms payment via `POST /api/stripe/checkout/confirm`.

### Environment variables

```env
STRIPE_SECRET_KEY=sk_test_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

When `STRIPE_SECRET_KEY` is unset, Stripe routes return `503` and owners can use legacy non-Stripe paths in development.

### Stripe API routes

| Flow | API |
|------|-----|
| Subscription at signup or plan change | `POST /api/stripe/checkout/subscription` |
| Add payment during trial | `POST /api/stripe/checkout/subscription` (current `planId`) |
| SMS top-up | `POST /api/stripe/checkout/sms` |
| Confirm after redirect | `POST /api/stripe/checkout/confirm` |
| Manage payment method | `POST /api/stripe/billing-portal` |

### Linking catalog items to Stripe

| Catalog | Admin UI | Stripe link |
|---------|----------|-------------|
| Subscription plan | `/dashboard/packages` | Leave **Stripe price id** blank to auto-create a **recurring** price on save; use **Add to Stripe** or checkout auto-links if missing |
| SMS package | `/dashboard/sms-packages` | Leave blank to auto-create a **one-time** price on save; **Add to Stripe** or checkout auto-links if missing |

Paste a manual `price_...` only when you created the price yourself in the Stripe Dashboard.

### Payment confirmation flow

1. Owner pays in Stripe Checkout (or adds payment during trial with `no_payment_required` when applicable).
2. Redirect to `?checkout=success&session_id=cs_...`.
3. Client hook `useStripeCheckoutReturn` calls `POST /api/stripe/checkout/confirm`.
4. Server verifies the session via Stripe API and applies billing or SMS credits **once** (see `stripe_fulfilled_sessions` below).

**Subscription checkout** calls `activateTenantSubscription()`:

- Different plan → `applyPlanChangeToTenant()` (updates limits + bundled SMS)
- Same plan during trial → links Stripe ids only; trial dates preserved until trial ends
- Same plan, not trialing → refreshes bundled SMS fields

### `stripe_fulfilled_sessions` — why it exists

Firestore collection `stripe_fulfilled_sessions` is an **idempotency ledger + purchase audit log** for Stripe Checkout. It ensures each paid checkout session is fulfilled **exactly once**, and it powers the super-admin **Purchase history** tables on `/dashboard/packages` and `/dashboard/sms-packages`.

#### The problem it solves

After Checkout, Stripe redirects the user back to the app (e.g. `/dashboard/sms?checkout=success`). The client then calls `POST /api/stripe/checkout/confirm` with the `session_id`.

That confirm request can run **more than once**:

- User refreshes the success page
- Browser back/forward navigation
- Network retries
- React effects re-running (especially in development)

Without a guard, the server could:

- Add SMS credits multiple times for one payment
- Activate or change a subscription multiple times

#### How it works

Implementation: `lib/stripe/fulfill.ts` (`confirmCheckoutSessionForBusiness`).

1. **Before fulfilling** — check whether `stripe_fulfilled_sessions/{sessionId}` already exists.
2. **If yes** — return `{ alreadyFulfilled: true }` and skip applying credits or billing again.
3. **If no** — retrieve the session from Stripe, verify `status === complete` and payment is `paid` (or `no_payment_required`), confirm the session belongs to the requesting business, then:
   - **SMS top-up** → `purchaseSmsPackageForBusiness()`
   - **Subscription** → `activateTenantSubscription()`
4. **After success** — write one document keyed by the Stripe Checkout Session ID (`cs_...`).

Each document stores a snapshot at fulfillment time:

| Field | Purpose |
|-------|---------|
| `sessionId` | Stripe Checkout Session ID (also the document ID) |
| `businessId` | Tenant that paid |
| `businessName`, `ownerName`, `ownerEmail` | Denormalized tenant/owner labels for history UI |
| `type` | `sms_topup` or `subscription` |
| `planId`, `planName`, `planPriceLabel` | Subscription purchase details (when applicable) |
| `smsPackageId`, `smsPackageName` | SMS top-up details (when applicable) |
| `fulfilledAt` | Server timestamp when fulfillment completed |

#### Second purpose: purchase history

`lib/catalog/tenant-package-usage.ts` reads this collection (newest first) to build **Purchase history** in `TenantPackageUsageLog` on the super-admin packages and SMS pages. Names are stored at purchase time so history stays readable even if a plan or package is later renamed.

#### Why Firestore instead of only Stripe?

- **Fast local idempotency check** before calling Stripe again
- **No webhook required** for fulfillment in this flow — confirmation happens on redirect via `POST /api/stripe/checkout/confirm`
- **Denormalized audit trail** for admin reporting without extra Stripe API calls per page load

#### What it is *not*

| Not this | Actual source of truth |
|----------|------------------------|
| Live billing state | Stripe + `businesses` (`billing_status`, `stripeSubscriptionId`, etc.) |
| Current SMS balance | `businesses` (`smsMessageLimit`, `smsMessagesUsed`, etc.) |
| Outbound SMS delivery log | `sms_logs` (separate collection) |
| Client-writable data | Written only by Admin SDK during server-side confirm |

**In short:** `stripe_fulfilled_sessions` = “this Stripe checkout was already processed” ledger, so payments are safe to confirm multiple times and super admins can see who bought what and when.

### Plan change rules

- **Upgrade** — always allowed (via Stripe when configured).
- **Downgrade** — blocked if `staffCount > targetPlan.staff` (remove staff in Team management first).
- Validated in `assessPlanChange()` before checkout and again in `applyPlanChangeToTenant()`.

---

## Firestore fields (`businesses`)

### Subscription & billing

| Field | Purpose |
|-------|---------|
| `planId` / `plan` | Current subscription plan |
| `staffLimit` / `currentStaffCount` | Plan staff cap and usage |
| `billing_status` | e.g. `trialing`, `active`, `pending`, `canceled` |
| `accountStatus` | e.g. `active_trial`, `active`, `pending_payment` |
| `hasFreeTrial` / `trialDays` | Trial configuration |
| `trial_start` / `trial_end` | Trial period (ms timestamps) |
| `subscriptionPeriodStart` / `subscriptionPeriodEnd` | Current billing period |
| `stripeCustomerId` | Stripe customer |
| `stripeSubscriptionId` | Active Stripe subscription |

### SMS

| Field | Purpose |
|-------|---------|
| `smsPackageId` / `smsPackage` | Active bundled or last-linked package snapshot |
| `smsMessageLimit` / `smsMessagesUsed` | Total allowance and usage |
| `smsBundleQuota` | Bundled portion of the limit (top-ups sit above this) |
| `smsBundleRenewsWithPlan` | Bundled SMS resets on subscription renewal |
| `smsBundlePeriodEnd` | When bundled SMS renews (aligned with subscription period) |

---

## Firestore collection — `stripe_fulfilled_sessions`

One document per fulfilled Stripe Checkout Session. Document ID = Stripe `sessionId` (e.g. `cs_test_...`).

Written by `markSessionFulfilled()` in `lib/stripe/fulfill.ts` after a successful confirm. Not written by clients or Stripe webhooks in the current flow.

Used for:

1. **Idempotency** — `isSessionFulfilled()` prevents double-granting SMS credits or re-applying subscription changes.
2. **Purchase history** — `listPurchaseLogs()` in `lib/catalog/tenant-package-usage.ts` for super-admin UI.

See [Payment confirmation flow](#payment-confirmation-flow) and [`stripe_fulfilled_sessions` — why it exists](#stripe_fulfilled_sessions--why-it-exists) for the full explanation.

---

## Testing (Stripe test mode)

1. Set test keys in `.env.local` (see above).
2. Restart the dev server.
3. Use test card **`4242 4242 4242 4242`**, any future expiry, any CVC.

| Scenario | Where to test |
|----------|----------------|
| Link plans to Stripe | `/dashboard/packages` → **Add to Stripe** or save plan |
| Link SMS packages | `/dashboard/sms-packages` → **Add to Stripe** or save package |
| Trial + add payment | `/dashboard/subscription` → **Add Payment Details** |
| Upgrade / downgrade | `/dashboard/subscription` → plan card button |
| SMS top-up | `/dashboard/sms` → **Top up package** |
| Signup + subscribe | `/onboard` → complete signup → Stripe redirect |

Confirm fulfillment in the browser network tab: `POST /api/stripe/checkout/confirm` should return `{ ok: true }`. A second confirm for the same `session_id` should return `{ ok: true, alreadyFulfilled: true }` without changing balances again.

---

## Related docs

- Stripe (detailed): `lib/stripe/README.md`
- SMS package server logic: `lib/sms-packages/`
- Subscription plan server logic: `lib/subscription-plans/`
