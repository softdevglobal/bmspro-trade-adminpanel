# Customer payments — Stripe Connect (deposits & invoices)

Lets a tradie's customers pay **quotation deposits** and **invoices** online by card.
Built on **Stripe Connect (Standard OAuth)** with **Direct Charges**, so funds land in
the tradie's own Stripe balance and the tradie is Merchant of Record. This is separate
from the platform billing in [`lib/stripe/README.md`](../stripe/README.md) (subscriptions
and SMS top-ups, which use the platform's own Stripe account).

All amounts are computed on the server from stored records — the client never supplies a
price. **Webhooks are the source of truth**; the redirect-return confirm is only for a
snappy UX.

## What each side does

| Actor | Action |
|-------|--------|
| Business owner | Settings → **Online payments (Stripe)** → *Connect with Stripe*, then picks who pays the fee |
| Owner / staff | On a sent quotation with a deposit, or a sent invoice → **Copy payment link** and share it |
| Customer | Opens `/pay/quotation/{token}` or `/pay/invoice/{token}` (no login) → pays via Stripe Checkout |
| Stripe | Fires `checkout.session.completed` → our webhook marks it paid in Firestore |

## Environment variables

Add to `.env.local`:

```env
# Platform Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CLIENT_ID=ca_...                 # Connect OAuth client id
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Processing fee for the "customer pays the fee" gross-up (defaults shown)
STRIPE_FEE_PERCENT=2.9
STRIPE_FEE_FIXED_CENTS=30
```

| Variable | Required | Purpose |
|----------|----------|---------|
| `STRIPE_SECRET_KEY` | Yes | Platform Stripe SDK (also used for `stripeAccount` Direct Charges) |
| `STRIPE_CLIENT_ID` | Yes | Standard OAuth onboarding (`ca_...`) |
| `STRIPE_WEBHOOK_SECRET` | Yes | Verifies webhook signatures |
| `NEXT_PUBLIC_APP_URL` | Yes | Base URL for the OAuth redirect, payment links, and Checkout return URLs |
| `STRIPE_FEE_PERCENT` / `STRIPE_FEE_FIXED_CENTS` | No | Fee rate for the customer-pays-fee gross-up (default 2.9% + $0.30) |

## Stripe Dashboard setup (test mode)

Do this once, in **Test mode**.

### 1. Enable Connect OAuth + register the redirect URI

1. **Settings → Connect** (`https://dashboard.stripe.com/test/settings/connect`).
2. Under **Onboarding options → OAuth**, enable **"OAuth for Standard accounts"**.
3. Under **Redirects**, add — character for character:
   ```
   http://localhost:3000/api/stripe/connect/callback
   ```
   For production also add `https://<your-domain>/api/stripe/connect/callback`.

### 2. Create the webhook endpoint

1. **Developers → Webhooks → Add endpoint**.
2. Endpoint URL:
   ```
   http://localhost:3000/api/stripe/webhook        (prod: https://<your-domain>/api/stripe/webhook)
   ```
3. **Important:** tick **"Listen to events on Connected accounts"** — deposit/invoice
   charges happen on the connected account, so their events only arrive with this on.
4. Select events:
   - `checkout.session.completed` — marks a deposit/invoice paid
   - `account.updated` — flips the business to "active" once charges are enabled
   - (the existing `invoice.paid` / `customer.subscription.deleted` remain for billing)
5. Copy the endpoint's **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

### 3. Local testing with the Stripe CLI

The public webhook URL above won't reach `localhost`, so forward events with the CLI:

```bash
stripe login
# Forward BOTH platform and connected-account events to the local webhook:
stripe listen --forward-connect-to localhost:3000/api/stripe/webhook \
              --forward-to localhost:3000/api/stripe/webhook
```

The CLI prints a `whsec_...` — use that as `STRIPE_WEBHOOK_SECRET` while testing locally.
Test card: `4242 4242 4242 4242`, any future expiry, any CVC, any postcode.

## Data model (additive)

**`businesses/{id}`**
- `stripeConnectAccountId: string | null` — connected account (`acct_...`)
- `stripeConnectOnboarded: boolean` — charges enabled
- `feePayerMode: "business" | "customer"` — who pays the processing fee (default `business`)

**`quotations/{id}`**
- `depositPayment` — settled deposit `{ status, amountAud, feeAud, totalChargedAud, feePayerMode, stripeCheckoutSessionId, stripePaymentIntentId, paidAt }`
- `depositRequest.paid` flipped to `true`

**`invoices/{id}`**
- `payments: []` — history of settled Stripe payments
- `amountPaidAud` — cumulative; `balanceDueAud` decremented per payment; `status → paid` at zero

**Server-only collections** (via `adminDb`, never read by clients):
- `payment_links/{token}` — opaque token → `{ type, businessId, targetId }`
- `payment_receipts/{sessionId}` — idempotency guard + audit
- `stripe_oauth_states/{state}` — single-use CSRF state for the OAuth callback

## Fee logic ([`lib/stripe/fees.ts`](../stripe/fees.ts))

- **Business absorbs:** customer pays exactly the amount; Stripe's fee is deducted from the
  connected account's payout.
- **Customer pays:** grossed up so the tradie nets the full amount:
  `gross = round((base + fixed) / (1 − rate))`. The fee line is shown at checkout.

## Code map

```
lib/stripe/
├── fees.ts                 computePaymentAmounts() — single source of truth for amounts
├── connect.ts              OAuth URL, code exchange, connected-account storage
├── payment-links.ts        create/resolve secure tokens
├── payments.ts             createPaymentCheckoutSession() — Direct Charge on connected acct
├── payment-fulfillment.ts  idempotent fulfill + redirect-return confirm
└── webhook-handlers.ts     +checkout.session.completed, +account.updated

lib/payments/
├── public.ts               getPublicPaymentContext(token) — page + checkout data
└── types.ts                shared payment record types

app/api/stripe/connect/route.ts            GET authorize url · DELETE disconnect (owner)
app/api/stripe/connect/callback/route.ts   OAuth callback → stores account
app/api/payments/link/route.ts             POST mint link (owner/staff)
app/api/payments/checkout/route.ts         POST create Checkout (public, by token)
app/api/payments/confirm/route.ts          POST redirect-return confirm (public)

app/pay/quotation/[token]/page.tsx         public deposit payment page
app/pay/invoice/[token]/page.tsx           public invoice payment page
components/public-payment-checkout.tsx     shared customer-facing checkout UI
components/business-payments-settings.tsx  Settings card (connect + fee mode)
components/payment-link-button.tsx         "Copy payment link" for the boards
```

## Testing checklist

- [ ] Connect OAuth enabled + redirect URI registered (test mode).
- [ ] Webhook endpoint added with **connected accounts** enabled; secret in `.env.local`.
- [ ] Settings → Online payments shows **Connected & active** after connecting.
- [ ] Sent quotation with a deposit shows **Copy deposit payment link**; `/pay/quotation/{token}` shows the amount (+ fee if customer-pays) and total.
- [ ] Pay with `4242…` → returns to the page as **Payment received**; quotation shows **Deposit paid** with date + reference.
- [ ] Sent invoice → **Copy payment link**; paying settles the balance and flips status to **paid** with payment history.
- [ ] Re-opening a paid link shows the paid state and cannot be paid again.
```
