# Stripe billing — BMS Pro Trade Admin Panel

Stripe powers **subscription plans** (recurring) and **SMS top-ups** (one-time payments). Catalog items live in Firestore; each plan/package stores a `stripePriceId` configured in the super-admin UI.

No webhook secret is required. After Checkout, Stripe redirects back to your app and the server confirms the session via the Stripe API.

## Quick summary

| Flow | Checkout mode | Confirmation | App effect |
|------|---------------|--------------|------------|
| Owner subscribes at signup | `subscription` | `POST /api/stripe/checkout/confirm` | Activates tenant billing + stores Stripe ids |
| SMS top-up | `payment` | `POST /api/stripe/checkout/confirm` | `purchaseSmsPackageForBusiness()` |

## Environment variables

Add to `.env.local`:

```env
# Server — required for Checkout and Customer Portal
STRIPE_SECRET_KEY=sk_test_...

# Client — when set, UI uses Checkout instead of free direct top-up
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

# Redirect URLs for Checkout success/cancel (no trailing slash)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `STRIPE_SECRET_KEY` | Yes (for billing) | Server Stripe SDK |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Recommended | Enables Checkout buttons in the UI |
| `NEXT_PUBLIC_APP_URL` | Recommended | Checkout `success_url` / `cancel_url` base |

When `STRIPE_SECRET_KEY` is unset, Stripe API routes return `503` and SMS top-up falls back to the legacy free `POST /api/business/sms` path (non-production only).

## Stripe Dashboard setup

### Products and prices

For each **subscription plan** in `/dashboard/packages`:

1. Create a **Product** in Stripe (e.g. "Starter").
2. Add a **recurring Price** (monthly/yearly as needed).
3. Copy the Price id (`price_...`) into the plan’s **Stripe price id** field in the admin UI.

For each **SMS package** in `/dashboard/sms-packages`:

1. Click **Add to Stripe** on an unlinked package, or save the package — a Stripe Product and one-time Price are created automatically when `STRIPE_SECRET_KEY` is set.
2. Optionally paste an existing Price id (`price_...`) in the package editor to use a manual Stripe price instead.

### Customer Portal (optional)

Settings → Billing → Customer portal — enable so owners can update payment methods via `POST /api/stripe/billing-portal`.

## API routes

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `POST` | `/api/stripe/checkout/subscription` | Business owner | Start plan Checkout |
| `POST` | `/api/stripe/checkout/sms` | Business owner | Start SMS top-up Checkout |
| `POST` | `/api/stripe/checkout/confirm` | Business owner | Confirm payment after redirect |
| `POST` | `/api/stripe/billing-portal` | Business owner | Stripe Customer Portal |

### Checkout request bodies

```json
{ "planId": "<subscription_plans doc id>" }
```

```json
{ "packageId": "<sms_packages doc id>" }
```

```json
{ "sessionId": "cs_test_..." }
```

## Code map

```
lib/stripe/
├── README.md          ← this file
├── config.ts          isStripeConfigured(), getAppBaseUrl()
├── client.ts          getStripe() singleton
├── public.ts          isStripeCheckoutEnabled() (client)
├── customers.ts       getOrCreateStripeCustomerId()
├── checkout.ts        Checkout + Billing Portal sessions
├── billing.ts         activate / cancel helpers
├── fulfill.ts         confirm + apply credits / billing
└── use-stripe-checkout-return.ts  client hook after redirect

app/api/stripe/
├── checkout/subscription/route.ts
├── checkout/sms/route.ts
├── checkout/confirm/route.ts
└── billing-portal/route.ts
```

## How confirmation works

1. Owner completes Stripe Checkout.
2. Stripe redirects to `success_url` with `?checkout=success&session_id=cs_...`.
3. The client calls `POST /api/stripe/checkout/confirm` with the session id.
4. The server retrieves the session from Stripe, verifies payment, and applies credits or billing **once** (tracked in `stripe_fulfilled_sessions`).

## Firestore fields (`businesses`)

| Field | Set by |
|-------|--------|
| `stripeCustomerId` | First Checkout or Customer Portal |
| `stripeSubscriptionId` | Subscription Checkout confirm |
| `billing_status` | Confirm flow (`active`) |
| `accountStatus` | Confirm flow (mirrors billing) |

## User flows

### Self-signup with subscription

1. Owner completes `/onboard` and selects a plan.
2. `POST /api/onboarding/submit` creates the tenant.
3. If `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set, after sign-in the app redirects to Stripe Checkout.
4. On return to `/dashboard`, payment is confirmed automatically.

### SMS top-up

1. Owner opens `/dashboard/sms`.
2. **Pay with Stripe** → redirect to Checkout.
3. On return, confirm runs and SMS credits are added.

In production, when Stripe is configured, `POST /api/business/sms` (direct free top-up) is disabled.

## Testing checklist

- [ ] Plans and SMS packages have valid `stripePriceId` values.
- [ ] `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set in `.env.local`.
- [ ] Test card `4242 4242 4242 4242`, any future expiry, any CVC.
- [ ] After subscription Checkout: `businesses.stripeSubscriptionId` and `billing_status: active`.
- [ ] After SMS Checkout: SMS balance increases on `/dashboard/sms`.

## Related docs

- Subscription catalog: `subscription/readme/README.md`
- SMS packages: `lib/sms-packages/`
