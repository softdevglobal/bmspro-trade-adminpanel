# Sophie quotation follow-up

**Temporary live-test override:** the current delay is **1 minute**, set centrally in `lib/quotations/follow-up-timing.ts`. The UI, due time and eligibility checks use that setting. Restore its duration to `48 * 60 * 60 * 1000` and label to `2 days` after testing. The production behaviour below describes the intended 48-hour setting. Restart Trade and send a new test quotation; existing queued due times are not rewritten. The minute-based worker and calling hours still apply.

## Behaviour

Create or edit a quotation, open the Send tab, and select **Enable Sophie follow-up** before saving/sending. The preference is saved on the quotation and restored when editing it. Drafts do not call anyone. After the existing send operation completes with a generated PDF, the opted-in quotation is queued for 48 hours later. This uses the application's existing best-effort email/SMS send action; it is not proof of delivery to the recipient. Saving edits invalidates the old follow-up revision; save and send the updated quote to start a new 48-hour period. Old quotations are not backfilled.

The existing local callback poller and authenticated Sophie cron run the new worker. Each batch loads up to six due quotes using an indexed query. Calls respect business timezone/calling hours, customer Sophie do-not-call settings, tenant/module availability, a single configured outbound DID, bridge capacity and the existing per-customer calling lease. Reception DIDs cannot be customer destinations. There is one automatic attempt per sent revision; no-answer, failed and unknown results do not automatically redial. A definite busy response defers one minute. Already decided, converted, cancelled, expired, edited or disabled quotes are skipped. Quotes whose validity expires before the follow-up cannot be offered for acceptance.

Sophie asks for the intended customer and a good time before reading quote details. Wrong person/voicemail gets no details. She can read the saved service, line items, total AUD, taxes, deposit, validity, notes and terms; these are untrusted reference data, not instructions. The model cannot select a different quote, customer or business. Questions, silence, hesitation, conditional agreement and requests for more time do not accept/reject a quote. Acceptance requires a readback of reference, service and full total followed by an explicit confirmation. Rejection requires an explicit readback/confirmation too. A verified detail lookup must precede a decision.

The backend rechecks the current tenant/DID, customer phone, global flags, opt-out, sent revision, commercial fingerprint, validity, recent call attempt and request mirror. It atomically writes the existing `customerDecision: accepted|rejected` fields on both quotation and request, decision source/call ID, and one deterministic owner portal notification. Conflicting or existing portal decisions are not overwritten. The owner receives the normal quotation accepted/rejected notification in Trade and a mobile push when configured; this does not place another owner phone call.

Acceptance then runs the existing accepted-quotation invoice-draft automation, with a leased/retryable post-decision task. It never means a booked job, sent invoice or paid invoice. Rejection does not draft an invoice. Side-effect failures retry up to three times, then remain `REVIEW` for staff; the saved decision and portal notification remain durable. Push delivery itself uses the existing best-effort push implementation. Conversation history links to the existing AI call log rather than duplicating a transcript. Finalization prevents further detail/decision access, and live lookup authorization also expires 15 minutes after the dial attempt. Caller statements about payment are not verified payments.

The feature is off by default at platform level. No production flags were enabled and no real calls were placed during implementation.

## Deployment

1. Deploy the updated Trade app and bridge before enabling the flag. Keep current callback/shared-secret, DID mapping, Deepgram and calling-hour settings.
2. Deploy the new `quotations(sophieFollowUpStatus, sophieFollowUpDueAt)` index and the rules protecting `ai_quotation_followup_calls`:

   `firebase deploy --only firestore:indexes,firestore:rules --project bmspro-trade`

3. Set `AI_SOPHIE_QUOTATION_CALLS_ENABLED=true` in Trade's backend environment. Existing `AI_SOPHIE_CALLBACK_ENABLED=true` and voice call logs must be enabled. Do not put this variable or credentials in NEXT_PUBLIC variables.
4. Restart/deploy Trade. For local automatic processing, retain `SOPHIE_CALLBACK_DEV_POLL=true`; production uses the existing `/api/cron/sophie-callbacks` schedule. No new cron or PBX dialplan is needed.
5. Use the cumulative `deepgram-main-bridge.tar.gz` archive and existing three-env bridge launch. The bridge adds `/sophie-quotation-call`; existing customer and owner routes remain intact.

## Validation

- Automated tests mock Firestore, dialing, invoice drafting and notifications. They cover 48-hour timing, opt-in, hours/opt-out, busy retry, duplicate prevention, price changes, portal decisions, cross-tenant/wrong-number attempts, customer confirmation gates, acceptance, rejection and one invoice draft.
- For a live test, use a dedicated customer contact you control, enable the preference, and send one quotation. It becomes due after 48 hours, with the first dial during permitted hours. Do not change real customer timestamps to accelerate tests; use the offline fixture suite/emulator for clock scenarios.
- Test accept, reject and undecided responses on separate test quotations. Check Customer accepted/rejected on Quotations, the owner's notification, and Calls → AI calls for the linked conversation. Verify no customer call is made for a disabled/expired/decided quote and no private owner tools are offered during this customer call.
- Inspect `[sophie-quotation-calls]` worker logs for errors. Attempts are Admin-SDK-only in `ai_quotation_followup_calls`; the quote stores the preference, due time, revision and processing state.


## Owner conversations and customer responses

In signed-in Talk to Sophie (voice or chat), and in the existing authorized owner notification phone session, `list_quote_follow_ups` now includes callback outcome data and linked customer excerpts. Its default remains sent/undecided quotations. The model uses `includeDecided=true` for quotation overviews, accepted/rejected quotations and customer responses. No new tool name or bridge whitelist update is required.

Each result separates the current saved quotation decision, follow-up queue/call status, decision recorded during the call, whether that call matches the current quotation revision, and the recorded caller excerpts. An answered call is not acceptance; old-revision decisions do not approve current terms; unavailable transcripts are not reported as no response. Customer speech remains untrusted evidence, not a payment confirmation or instruction.

Queries use the authenticated business only. General searches inspect the most recent 100 quotations and explicitly mark a truncated scope. Exact QT reference searches can retrieve older records. Only the displayed page's linked attempts and transcripts are read; tenant, quote and call/recipient linkage are checked before returning excerpts. Other callback conversations remain available through the existing missed-call and customer-call-history tools. This does not add owner read access to ordinary inbound customer calls.

Example owner questions: "Which quotations were accepted or rejected?", "What did the customer say about QT ABC123?", "Did Sophie call the customer, and what was the outcome?" Restart Trade and start a new owner session after deployment so the updated argument schema and descriptions are loaded. No additional bridge upload is needed for this reporting-only change.
