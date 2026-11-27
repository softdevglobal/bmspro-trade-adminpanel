# Invoice follow-up review

The wider customer contact-frequency policy remains a separate decision. Confirmed unanswered invoice calls now get one additional attempt after a temporary two-minute delay. The interval is centralized in `lib/invoices/follow-up-timing.ts` and can be changed later. Answered, failed and unknown outcomes never create this retry. There is no endless retry loop.

The original no-answer result is preserved. A separate retry appears in invoice history and Scheduled calls, and uses the existing scheduled-call worker. It becomes eligible after two minutes and runs at the next worker check, subject to calling hours, invoice state, current contact, opt-out, active-call leases and review pauses. Pending retries block another manual or automatic call for the same invoice. A cancelled retry stays cancelled. Existing past no-answer calls are not backfilled or redialled by this update. No new bridge upload, environment values or Firestore indexes are required for retry scheduling.

Sophie handles reminders and customer-response reporting only. Payment verification, settlement, revised terms and support decisions remain with the owner.

Sophie can now read only the invoice attached to a verified outbound invoice attempt, after the intended customer confirms they can speak. She explains the service and saved remaining balance without accessing other customer records. The bridge has no payment-write tool.

Confirmed reports of payment, disputes, hardship, payment-plan requests, promised payment dates and requests for help are recorded on the attempt. They pause the affected invoice's follow-ups and create an owner portal notification. No customer statement changes payment totals, invoice status or approved terms. Promises never automatically resume collection after the date passes.

Automatic/manual calls, scheduled invoice callbacks and overdue customer reminder emails check the saved hold. Dialing also checks the fresh invoice and saved checkout state. An active checkout reservation waits until settlement or expiry; this does not prove payment. A reconciliation-required receipt for the current checkout blocks contact. Uncertain invoice-call outcomes pause follow-ups for manual review instead of triggering another call. This does not implement automatic PBX or processor reconciliation, older/unallocated receipt matching, refunds, payment plans or statement/payment-link sending.

If an invoice dial request loses its HTTP response or receives a server error, Trade makes one authenticated read of `/sophie-callback/status`, scoped to the original attempt, business and DID. A verified terminal result can recover the outcome. Pending, missing, mismatched or unavailable results remain uncertain and are never retried as another POST. The bridge retains status in memory for one hour; a restart loses that evidence. Connection failures are saved using sanitized diagnostic codes rather than URLs or credentials. This improves recovery but cannot repair an unavailable SSH tunnel, PBX, or network.

When someone explicitly says they are the wrong person or the number is wrong, Sophie can flag the invoice contact before reading any invoice data. This pauses reminders and alerts the owner. Voicemail and uncertain answers are not wrong-contact confirmations. The owner must correct the invoice phone number and review the hold before resuming; the old destination cannot simply be unpaused.

## Owner review

Open the invoice and its **Sophie invoice calls** panel. The panel shows the pause reason, any promised date, recorded response and existing transcript links. After checking the ledger and customer issue, choose **Review and resume follow-ups** and confirm. Only the current business owner can clear the exact hold they reviewed. A changed hold requires a fresh review. Resuming does not place a call or mark payment; previously cancelled/skipped calls remain terminal. New eligible follow-ups or a manual call can run afterward. Customer do-not-call preferences remain independent.

Owner reports now pair the latest attempt with its own verified transcript rather than attaching a previous call's response to a newer failure. Transcript matching verifies the business, DID, attempt and saved phone key where available.

## Deployment

Deploy/restart Trade first, then upload the accompanying bridge archive and restart the bridge when idle. No new environment values, Firestore indexes or collections are required. Existing invoice and attempt records hold the new fields. New invoice attempts save the destination comparison key; older attempts cannot use the new tool session.

The new bridge module is `src/agents/trade/trade-invoice-follow-up.mjs`; `src/server/bridge.mjs` installs it only for outbound invoice calls. The new Trade bridge endpoint is `/api/ai/callbacks/invoice`. It verifies the current DID/business, attempt, saved destination and invoice contact. Tool payloads cannot choose an invoice, change balances or access arbitrary records.

## Test without real customer calls

Offline tests use mocked Firestore and dialing. For a live check, use a test invoice with your own number and an overdue date, then manually request a call. Say “I already paid”, confirm Sophie's readback, and verify a pause and owner notification appear while the ledger stays unchanged. Repeat with separate test attempts for a dispute or promised date. Confirm the invoice cannot be called while paused. Review and resume in Trade, then verify the call button becomes available subject to the existing calling settings and opt-out checks. No live calls were placed during implementation.
