# Business-mailbox email runbook (Stage 1 sending, Stage 2 inbox slice 1)

Owners connect their own Gmail account and send quotes and invoices from it.
Stage 1 only sends: no inbox access, and replies arrive in the business's
normal email app. Existing ZeptoMail notifications (from
`request@bmspros.com.au`) are unchanged; this adds a separate
**Send by email** action.

## How it fits together

| Piece | Where |
| --- | --- |
| Settings card (connect, reconnect, disconnect) | `components/email-connection-settings.tsx` |
| Send dialog and per-document history | `components/document-email-panel.tsx` (quote and invoice drawers) |
| Emails page: all sends, filters, retry (sidebar → Emails, hidden while the feature is off) | `app/dashboard/emails`, `components/emails-board.tsx` |
| Gmail transport (OAuth + PKCE, `users.messages.send`) | `lib/email-integration/providers/google.ts` |
| Connections, OAuth state, encrypted credentials | `lib/email-integration/connections.ts`, `crypto.ts` |
| Outbox: enqueue, leased worker, retry, history | `lib/email-integration/outbox.ts` |
| Recovery worker (every 5 min) | `app/api/cron/email-outbox` |

Sends are processed right after queueing (`after()`), and the cron picks up
retries and interrupted sends. Recipients, subject, body and the PDF are
frozen when queued, so editing the document later does not change a queued
email.

### Firestore collections (Admin SDK only; all client access is denied by the rules)

- `email_connections`: one active sender per business; metadata only.
- `email_connection_credentials`: AES-256-GCM encrypted tokens, same id as the connection.
- `email_outbox`: one doc per send; the doc id is derived from the idempotency key.
- `email_events`: append-only audit trail with safe codes, no bodies or tokens.
- `email_oauth_states`: single-use, 10-minute OAuth states.

Frozen PDFs are stored privately at `email-outbox/{businessId}/…` in the
default Storage bucket, with no download token.

### Outbox states

```
queued -> sending -> accepted
                  -> retry_wait -> queued        (safe, retryable failures; max 5 attempts)
                  -> failed | blocked_auth | unknown | held
```

- `accepted` means Gmail accepted the message. The UI says "Accepted by email
  provider" and never claims the email was delivered or read.
- `unknown` covers a timeout, a 5xx response, or a worker crash mid-send. It is
  never retried automatically. Staff check their Gmail Sent folder, then can
  choose **Send again** with explicit confirmation.
- `held` means the mailbox changed or was disconnected, or the sender lost
  permission. `blocked_auth` means the Gmail sign-in expired. Both resume only
  when an owner clicks **Retry**, and only through the same Gmail account.

## Permission matrix

| Action | Owner / admin | Staff (technicians) | Customer |
| --- | --- | --- | --- |
| Connect, reconnect, disconnect, test | Yes | No | No |
| Send quote/invoice by email | Yes | No | No |
| View send history, retry | Yes | No | No |

Permission is checked again by the worker at send time.

## Environment variables (names only)

| Name | Purpose |
| --- | --- |
| `EMAIL_SEND_ENABLED` | `true` turns the feature on. Off by default. |
| `EMAIL_SEND_PILOT_BUSINESS_IDS` | Optional comma list. When set, only these businesses get the feature. |
| `EMAIL_RECIPIENT_ALLOWLIST` | Optional comma list of addresses or `@domains`. Set it on non-production deployments. |
| `EMAIL_CREDENTIALS_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Use a different key per environment. Never commit it. |
| `GOOGLE_EMAIL_CLIENT_ID` | Google OAuth web client id. |
| `GOOGLE_EMAIL_CLIENT_SECRET` | Google OAuth web client secret. |
| `GOOGLE_EMAIL_REDIRECT_URI` | Must exactly match the redirect registered in Google. |
| `CRON_SECRET` | Already used by the other crons. |

Rotating `EMAIL_CREDENTIALS_KEY` makes the stored tokens unreadable. Owners
then see "Mailbox needs reconnecting" and reconnect.

## Google Cloud setup

Use separate development and production projects.

1. Enable the **Gmail API**.
2. Configure the OAuth consent screen: app name, support email, privacy
   policy URL and authorised domains.
3. Add the scopes `openid`, `email` and `https://www.googleapis.com/auth/gmail.send`.
   Stage 1 requests nothing else.
4. Create an OAuth client of type **Web application**, with this redirect URI:
   - production: `https://<app domain>/api/email/oauth/google/callback`
   - local: `http://localhost:3001/api/email/oauth/google/callback`
5. While the app is in "Testing", add the pilot owners' Gmail addresses as
   test users. Public launch needs Google verification, because `gmail.send`
   is a sensitive scope. Start that early.

## Deploy

1. Deploy the Firestore rules and indexes:
   `npm run firebase:deploy-rules`, then `firebase deploy --only firestore:indexes`.
2. Set the env vars with `EMAIL_SEND_ENABLED` unset, then deploy the app.
   `vercel.json` adds the `/api/cron/email-outbox` cron.
3. On a non-production deployment, set `EMAIL_SEND_ENABLED=true` and
   `EMAIL_RECIPIENT_ALLOWLIST`, then run the acceptance checks below.
4. In production, set `EMAIL_SEND_PILOT_BUSINESS_IDS=<pilot id>` and
   `EMAIL_SEND_ENABLED=true`. Widen the pilot list gradually.

## Acceptance checks

Automated:

- `npm run test:email-integration`: MIME building, header-injection guard,
  encryption and the feature/recipient gates.
- `npm run test:rules`: every role, super admin included, is denied direct
  access to the five email collections.

Manual, with a test Google account and controlled Gmail and Outlook recipients:

- [ ] Connect, then decline consent (no connection is saved). Connect again
      and untick the send permission (refused with a clear message).
- [ ] Compose a new email from Emails → Mailbox; it shows "Accepted by email provider" in the Send log and appears in Sent.
- [ ] Send a real quote and invoice. Check the From and To addresses, that
      replies go to the business, the PDF, the totals, and the pay link.
- [ ] Double-click Send: one history entry and one email arrive.
- [ ] Edit the document after it is queued; the email and PDF already queued
      do not change.
- [ ] Open the dialog, edit the document in another tab, then click Send. You
      get a stale-version notice with a refreshed preview.
- [ ] Revoke the app at myaccount.google.com/permissions, then send. The email
      shows "Mailbox needs reconnecting"; reconnect, then Retry sends it.
- [ ] Disconnect while an email is queued: it goes on hold and is not sent
      after connecting a different account.
- [ ] Owner of business B cannot read business A's history, preview or retry
      routes (all return 404).

## Monitoring

`email_outbox` and `email_events` carry ids and safe codes only. Watch for:

- queue age (items in `queued`/`retry_wait` with an old `nextAttemptAt`)
- the counts of `unknown` and `blocked_auth`
- `needs_reconnect` events

## Rollback

Unset `EMAIL_SEND_ENABLED`. The UI disappears, new sends are refused, and the
worker pauses. Outbox records and PDFs are kept for reconciliation. Do not
delete pending items or resend them from another mailbox. The owner reviews any
unresolved sends before the feature is turned back on.

## Not in this stage

- Microsoft (Outlook) and SMTP adapters. Each implements `EmailSendAdapter` in
  `providers/` and is added to `providers/index.ts`.
- Per-staff send grants (`email_connection_access`) and stored, editable
  templates. Defaults are generated from the document and editable per send.
- Serialising token refresh per connection. Google refresh tokens don't rotate,
  so concurrent refreshes are harmless today; this matters for Microsoft.
- Inbox, replies and customer timeline (Stage 2).


---

## Stage 2: mailbox inside the platform

Opt-in, owner-only, and separate from sending. A mailbox keeps working for
send if the owner never enables it or Google refuses.

**The whole mailbox is shown, all history** (spam and drafts excepted), and
every conversation is labelled with its link to the platform: a quote or
invoice the platform sent (violet / green), a known customer (blue; registered
customers plus the customer on requests, quotations, invoices and jobs), or not
linked. A "Customers only" switch filters to linked mail, and opening a linked
conversation shows the customer's quotes, invoices and jobs beside it. A
customer name is shown only when the address maps to exactly one name.

Import order: platform conversations, then an all-time Gmail search per batch
of customer addresses, then a sweep of the whole mailbox. It runs as a
resumable queue (`mailbox/backfill.ts`) in ~40-second steps, saving after each
page; the open Emails page keeps it going and the cron continues otherwise.
New customers are searched on the next sync, and their mail already imported is
re-labelled. Changing what is stored: bump `SYNC_SCHEMA_VERSION` in
`mailbox/sync.ts`; mailboxes are cleared and imported again on their next sync.

| Feature | Where |
| --- | --- |
| Folders Inbox / Starred / Sent / Archive / Trash, search (Gmail's search, limited to shown mail) | `GET /api/email/mailbox?view=&q=` |
| Conversation with sanitised HTML + plain text, bodies fetched on demand | `GET /api/email/mailbox/threads/:threadId` |
| Read/unread, star, archive, move to Inbox, trash, restore (needs `gmail.modify`) | `POST /api/email/mailbox/threads/:threadId/actions` |
| Attachment download (always `attachment`, `nosniff`) | `GET /api/email/mailbox/messages/:id/attachments/:attachmentId` |
| New email, reply, reply all, forward (+ original attachments), Cc/Bcc, file attachments | `POST /api/email/mailbox/send` → outbox |
| Customer suggestions for To/Cc/Bcc | `GET /api/email/mailbox/contacts` |
| Sync worker (resumable all-history import, then Gmail history) | `mailbox/sync.ts`, cron `/api/cron/email-sync` |
| Customer panel (quotes, invoices, jobs for a customer address) | `GET /api/email/mailbox/customer?email=` |
| UI | `components/mailbox-panel.tsx`, `mail-composer.tsx`, `mail-attachments.tsx`, `mail-customer-panel.tsx`, `email-html-frame.tsx` |

Attachments: raster images (PNG, JPEG, GIF, WebP, BMP; never SVG) show as
thumbnails with a full-size viewer, and images embedded with `cid:` show in
place. PDFs open in the browser's viewer; other files download. The browser
only ever creates image/PDF blobs; everything else is opaque bytes.

Safety of the preview: email HTML is cleaned on the server (scripts, frames,
forms, event handlers and `javascript:` links removed) and shown in an iframe
with `sandbox` (no `allow-scripts`) and a CSP of `default-src 'none'`. Remote
images load only after the user clicks "Show images". Links open in a new tab.

Replies keep the conversation threaded: Gmail `threadId` plus `In-Reply-To` and
`References` from the original. Every send (new, reply, forward) goes through
the same idempotent outbox as quotes and invoices and appears in the Send log.

Limits: browser uploads up to 4 MB per email (Vercel's request limit); forwarded
originals up to 15 MB in total; downloads up to 25 MB; 10 recipients per send.
Attachments are not virus-scanned; they are always served as downloads.

### Google setup

Google Auth Platform → **Data Access** → add
`https://www.googleapis.com/auth/gmail.modify` (restricted). It includes reading,
so `gmail.readonly` is no longer requested. Owners who enabled read-only access
earlier see an "Allow" banner to upgrade. Public launch needs Google's
verification and security assessment for this scope.

### Deploy

- `firebase deploy --only firestore:rules` (`email_messages`, `email_sync_state` server-only).
- `firebase deploy --only firestore:indexes` (five `email_messages` indexes: folders, Starred, the "Customers only" filter on both, and threads).
- The `/api/cron/email-sync` cron is in `vercel.json`.
