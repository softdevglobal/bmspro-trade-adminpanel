# Sophie outbound call safeguards

Sophie outbound calls have separate controls at the platform and business levels.

## Platform switches

- `AI_SOPHIE_CALLBACK_ENABLED=true` enables the callback bridge features, including owner-started calls and the missed-call retry worker.
- `AI_SOPHIE_INVOICE_CALLS_ENABLED=true` is an additional rollout switch for automatic overdue-invoice calls. It is off when unset. An owner must also enable **Sophie invoice calls** in Business settings before an overdue invoice reminder can queue a call.

Keep the invoice switch unset or `false` until controlled-number checks are complete.

## Business controls

- Super Admin → DID mappings controls automatic missed-call retries per business number. The business owner must also enable **Automatic missed-call follow-ups** in Settings → Sophie.
- The business owner’s Settings → Sophie section controls invoice-call permission and local calling hours.
- Calling hours default to weekdays, 9:00 AM–5:00 PM in the business timezone. Automatic calls are deferred outside the window.
- Business owners can block or restore Sophie calls for a number from Calls → Missed calls and from the invoice’s Sophie call panel. Preferences are scoped to that business.
- On an outbound Sophie call, a verified customer’s clear request to stop calls is saved as a business-scoped opt-out.

Before re-enabling automatic calls, verify an opted-out number is skipped, an out-of-hours call waits, missed-call retries and invoice calls can be enabled independently, and invoice calls remain off until the owner enables them.
