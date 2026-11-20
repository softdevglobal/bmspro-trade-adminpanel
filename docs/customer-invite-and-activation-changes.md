no no# Customer invite and activation changes

Changes to how owners add customers and how those customers activate their account.
Related plan: [customers-section-plan.md](customers-section-plan.md).

Status: code changed and type-checked (`tsc --noEmit` clean). Not yet tested in the running app.

---

## How it works now

1. The owner adds a customer (popup, voice assistant, MCP tool or browser form tool).
2. A login account is created with a random password that nobody knows. No default password is ever emailed.
3. The **invite checkbox is ticked by default**. If it stays ticked, the customer gets a welcome email with a single-use **Activate my account** link (valid 24 hours).
4. The link opens `/activate/<token>`. The page shows the customer's name, mobile and email (read-only) and asks them to choose a password (6 to 128 characters).
5. After activation the customer is signed in automatically and lands on `/booknow/<slug>/account`.
6. If the box is unticked, no email is sent. The customer is saved and has an account, but cannot log in until an invite is sent later.

Imported customers are still never emailed automatically (Spam Act). Customer-facing booking flows are unchanged.

---

## Changes

### 1. Invite email on by default

| Where | Change |
|---|---|
| [components/customer-form-modal.tsx](../components/customer-form-modal.tsx) | `sendInvite` state starts as `true`. Label now reads "On by default. Untick it if the customer should not be emailed yet." |
| [lib/ai/mcp/tools/owner-actions.tools.ts](../lib/ai/mcp/tools/owner-actions.tools.ts) | `prepareCustomerCreate` sends the invite unless `sendInvite` is explicitly `false`. The spoken summary matches. |
| [lib/ai/owner-call/owner-actions.ts](../lib/ai/owner-call/owner-actions.ts) | `prepare_customer_create` description: invite is sent by default, pass `sendInvite: false` only if the owner asks not to email. |
| [lib/ai/owner-call/owner-customer.ts](../lib/ai/owner-call/owner-customer.ts) | Browser form tool description updated the same way. The tool only changes the checkbox when it passes `sendInvite`. |

The API route `/api/customers` still sends the email only when the request has `sendInvite: true`. The popup and the MCP tool both pass it explicitly. Any other caller that omits it sends nothing.

How the AI agent controls it (voice, MCP and browser tool):
- Nothing passed: invite is sent.
- `sendInvite: false`: no email, and the browser tool unticks the box on screen.
- `sendInvite: true`: invite is sent.

### 2. Activation page shows the customer's details and signs them in

| File | Change |
|---|---|
| [lib/auth/activation.ts](../lib/auth/activation.ts) | New `getActivationPreview(token)`: read-only lookup (name, email, phone) that does not use up the token. Customers only. New `activateAccountDetailed()` also returns `kind`, `email` and `slug`. `activateAccount()` still returns the login path, so existing callers keep working. |
| [app/activate/[token]/page.tsx](../app/activate/[token]/page.tsx) | Loads the preview and passes it to the form. |
| [components/activation-form.tsx](../components/activation-form.tsx) | Shows the read-only details, then signs the customer in with the new password and redirects to the booking page. If automatic sign-in fails they still land on the page and can sign in there. |
| [app/api/auth/activate/route.ts](../app/api/auth/activate/route.ts) | Returns the extra fields the form needs. |

Staff and owner activations are unchanged.

### 3. Company and Address removed from the Add customer popup

| Where | Change |
|---|---|
| [components/customer-form-modal.tsx](../components/customer-form-modal.tsx) | Company and Address inputs and their review rows removed. Unused `patchAddress` and the company/address handling in the browser-tool handler removed. |
| [lib/ai/owner-call/owner-customer.ts](../lib/ai/owner-call/owner-customer.ts) | `company` and `address` removed from the form tool schema. |
| [lib/ai/owner-call/owner-actions.ts](../lib/ai/owner-call/owner-actions.ts) | `company` and `address` removed from the `prepare_customer_create` schema and description. |

Existing customers keep any company or address they already have. Editing them does not clear those values.

Not changed (decide if these should follow):
- `prepareCustomerUpdate` in `owner-actions.tools.ts` still accepts company and address.
- Customer search results still return company and address.
- The database fields and `/api/customers` still support both.

---

## Why no default password

- A fixed default password lets anyone who knows a customer's email and the business's booking slug log in.
- A random password sent in plain text stays valid until changed, and emails get forwarded and stored.
- The single-use activation link avoids both, so it stays the way customers get their password.

If a temporary password is wanted later, the safest option is a random one per customer, sent alongside the link, with the existing `mustChangePassword` flag forcing a change at first login.

---

## To test

1. Hard refresh the browser (Ctrl+Shift+R). If the old "Off by default" text or the Company and Address fields still show, restart `npm run dev`, or delete `.next` and start again.
2. Add a customer with the invite ticked. Check the review step shows only name, email, mobile and notes.
3. Open the welcome email and click **Activate my account**. Check the details are shown, set a password, and confirm you land on the booking page signed in.
4. Add a customer with the box unticked. Confirm no email arrives.
5. Ask the voice assistant or MCP tool to add a customer with no mention of email (should send), then with "don't email them" (should not).

---

## Item list

Everything that touches adding, editing, inviting and activating customers.

### A. Screens

| Item | File | Notes |
|---|---|---|
| Add / Edit customer popup | [components/customer-form-modal.tsx](../components/customer-form-modal.tsx) | Two steps (details, review). Invite checkbox ticked by default. No Company or Address fields. |
| Activation page | [app/activate/[token]/page.tsx](../app/activate/[token]/page.tsx), [components/activation-form.tsx](../components/activation-form.tsx) | Booking-page backdrop, read-only name, mobile and email, password of 6 to 128 characters, signs the customer in afterwards. |
| Welcome email | `sendCustomerWelcomeEmail` in `lib/email/templates` | "Activate my account" link, single use, valid 24 hours. No password in the email. |

### B. API and server

| Item | File | Notes |
|---|---|---|
| `POST /api/customers` | [app/api/customers/route.ts](../app/api/customers/route.ts) | Adds one customer. Sends the invite only when `sendInvite` is `true`. |
| `PATCH /api/customers/[id]` | [app/api/customers/[id]/route.ts](../app/api/customers/[id]/route.ts) | Edits a customer. The email is locked once they have logged in. |
| `createBusinessCustomer` | [lib/customer/manage.ts](../lib/customer/manage.ts) | Duplicate check, then `ensureCustomerAccount`. |
| `ensureCustomerAccount` | [lib/customer/server.ts](lib/customer/server.ts) | Creates the login with a random unknown password and flags it for activation. |
| `getActivationPreview`, `activateAccountDetailed` | [lib/auth/activation.ts](../lib/auth/activation.ts) | Read-only preview; activation that returns the sign-in details. |
| `POST /api/auth/activate` | [app/api/auth/activate/route.ts](../app/api/auth/activate/route.ts) | Sets the password and consumes the link. |

### C. Owner voice, MCP and browser tools (adding and editing)

| Tool | Where | What it does | Invite default |
|---|---|---|---|
| `get_customers` | owner voice and MCP | Searches by name, email or phone (read-only) | n/a |
| `prepare_customer_create` | [owner-actions.ts](../lib/ai/owner-call/owner-actions.ts), [owner-actions.tools.ts](../lib/ai/mcp/tools/owner-actions.tools.ts) | Prepares an add; the owner confirms before saving | Sends unless `sendInvite: false` |
| `prepare_customer_update` | same files | Prepares an edit; the email cannot be changed | n/a |
| `open_add_customer`, `open_edit_customer` | [owner-customer.ts](../lib/ai/owner-call/owner-customer.ts) | Opens the popup on screen | n/a |
| `customer_form_step` | [owner-customer.ts](../lib/ai/owner-call/owner-customer.ts) | Fills fields, continues, goes back, saves | Box starts ticked; `sendInvite: false` unticks it |
| `list_customers` | [owner-customer.ts](../lib/ai/owner-call/owner-customer.ts) | Lists customers on the open page | n/a |

All of these work only when `ownerCustomersEnabled()` is on. Company and address are no longer offered by `prepare_customer_create` or `customer_form_step`. `prepare_customer_update` still accepts them.

### D. Caller-side voice tools (a customer ringing the business)

| Tool | Needs |
|---|---|
| `get_business_profile`, `list_services`, `find_customer`, `get_available_slots`, `find_job` | Always on |
| `search_business_knowledge` | `AI_VOICE_KNOWLEDGE_ENABLED=true` |
| `register_customer`, `create_inspection_request`, `create_job_booking` | `AI_VOICE_ACTIONS_ENABLED=true` |
| `cancel_job` | `AI_VOICE_ACTIONS_ENABLED=true` and the owner has given Sophie job authority |
| `reschedule_job` | The `cancel_job` conditions plus `AI_AUTO_ASSIGN_STAFF_ENABLED=true` |

`register_customer` creates the account with no email at that moment. It then sends its own welcome email with the activation link in the background, so callers also get the new activation page.

### E. Configuration

| Setting | Where | Why |
|---|---|---|
| `APP_URL=http://localhost:3001` | `.env.local` | Activation links were pointing at port 3000. The dev server runs on 3001. Set it to the real domain when deployed. |
| `AI_VOICE_BRIDGE_SECRET` and the bridge's `BMSPRO_TRADE_BRIDGE_SECRET` | Trade `.env.local` and the voice bridge `.env` | Must match (they do). The bridge runs on port 8788. |

### F. Still open

- Remove company and address from `prepare_customer_update` and from customer search results, if wanted.
- Decide whether the password minimum should go back above 6.
- Add a "send invite later" button for customers saved without one. I haven't checked whether the UI has one.
- Test the whole flow in the running app.
