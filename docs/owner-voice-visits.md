# Talk to Sophie: jobs and inspections

Single-visit work can be looked up, created, scheduled/rescheduled, assigned/reassigned or cancelled after a readback and explicit owner confirmation. These tools run on the Trade server in both browser and MCP tool modes. They do not open or fill the dashboard editor.

## Enable

1. Deploy the updated bridge `src/agents/trade/trade-owner-voice.mjs` whitelist and restart the bridge using your existing service/start command.
2. Set `AI_OWNER_VOICE_VISITS_ENABLED=true` in the Trade server environment and restart Trade. The flag is off by default; it is independent of `AI_OWNER_VOICE_TOOL_MODE`.
3. Open a new Talk to Sophie session as the business owner.

## Try with test records

- Ask: "Show my jobs for [date]" or "Find inspections for [customer]." Use the actual returned reference.
- Ask: "What are the scheduled jobs?" Sophie uses `get_work_visits` with `kind=job` and `status=scheduled`, across all dates. She states the dates of returned visits. Only an explicitly requested date should narrow this list to one day; today's daily summary cannot establish that there are no scheduled jobs on other dates.
- "Assign job [reference] to [exact staff full name]." Listen to the summary, then confirm. For an unscheduled visit, confirm assignment first, then schedule it separately.
- "Move inspection [reference] to [date], 9 AM to 10 AM." Confirm, then check its calendar and detail page.
- Prepare another change and say no: verify that nothing changes.
- Prepare a change, edit the record in another tab, then confirm: Sophie should require a fresh proposal.
- Attempt an overlapping visit, staff leave/day off, closed date or cancellation of completed work: it should be rejected.
- Cancel a test visit and confirm: it should remain in history with cancelled status.
- Say "Add a job" and provide the customer's full name/email/phone, exact configured service, future date/start/end, an agreed total in AUD and the owner or an exact staff full name. Address and notes are optional and appear in the readback. Say no first and verify no job was created. Prepare again, confirm, then check the new job reference, assignee, time and quotation amount. Use test customer contact details: the existing Add job customer-account and notification behavior applies.
- Say "Add an inspection" and provide verified customer name/email/phone, a configured service and exact future date/start/end. Alternatively say "Create an advice inspection" and provide an advice title/details instead of a service. Review the readback, including that no inspector is assigned. Say no and check that no request was created; prepare again, confirm, and check the scheduled request reference in Site inspections. Assign staff in a separate confirmed step using that reference. Address and notes are optional. No job, accepted quotation or invoice is created by this inspection action.

The tools are `get_work_visits`, `prepare_job_create`, `prepare_inspection_create`, `prepare_job_schedule`, `prepare_job_assignment`, `prepare_job_cancel`, `prepare_inspection_schedule`, `prepare_inspection_assignment`, `prepare_inspection_cancel`, plus the shared `confirm_owner_change` and `cancel_owner_change`. Visits also expose read-only `get_services` and `get_staff` so creation can use exact configured names. Deploy the updated bridge whitelist before starting a new session.

## Scope and safeguards

Only the logged-in business owner's records are accessible. Changes require an exact reference, a stored proposal, time for readback and a new affirmative reply. Each proposal changes one record/action. A rejected replacement clears an older pending change. Confirmation consumes the proposal before dispatching to the existing authenticated Trade route.

Availability, configured service eligibility, leave, existing work, travel buffer, business hours, closures and capacity are checked at preparation and again at confirmation. The final record write uses its Firestore version so an intervening edit fails rather than overwrites the record. Availability checks across other records are preflight checks; this does not introduce a transaction locking the whole calendar.

Recurring/multi-day jobs, linked inspections, started/completed/missed work and jobs without a configured service require the Trade editor. Advice inspections use the existing quotation permission when assigning staff, without inventing a service. Cancellation preserves history and uses existing linked-record/notification behavior. An uncertain API outcome tells the owner to check Trade before retrying.

New job creation requires a future schedule, an eligible assignee and an explicit agreed price (including zero for free work). It uses the authenticated `POST /api/jobs` Add job route, with its normal completed request/accepted quotation, customer account, notification, audit and possible invoice-draft effects. The readback explains those effects. Preparation stores a proposal only; confirmation consumes it before attempting creation. Service changes, staff eligibility and availability are checked again at confirmation. A lost response returns UNKNOWN with instructions to verify Jobs, rather than retrying automatically. This is for already agreed work, not an unaccepted quotation. Customer contacts must be provided or verified; missing contacts and prices are never inferred.

New inspection creation uses authenticated `POST /api/requests`, matching Add inspection: one scheduled, unassigned request and its existing customer-account, notification and audit behavior. It supports `existing_service` with an exact active business service, or `custom_quote` with an advice title/details and no service. It does not collect an agreed job price or create an accepted quotation/invoice. The readback explicitly says the inspector remains unassigned. Preparation and confirmation check owner access, a real future date, business hours, closures, inspection capacity and service eligibility/version. Staff availability is checked during the separate assignment action. The shared confirmation claim prevents applying the same pending proposal twice; an uncertain creation response requires checking Site inspections before retrying. No new polling is introduced.

Reads run on demand; there is no new polling or reminder worker. Visit lists read up to 51 documents per selected kind and show up to 50, with a partial-results notice. Availability checks read the existing business scheduling datasets, so these actions still incur Firestore reads. Existing missed-call, scheduled-call and overdue-invoice automations are unchanged.

## Local checks

`npx tsx --import ./scripts/stub-server-only.mjs --test scripts/test-owner-visits.ts scripts/test-ai-owner-call.ts scripts/test-ai-owner-service.ts scripts/test-ai-assignment-transaction.ts scripts/test-ai-staff-assignment.ts`

In the bridge repository: `node --test tests/owner-voice.test.mjs`.

These use fixtures; they do not place calls or modify real records. Run the manual cases above against test records before enabling for normal use.

## Session fails before Sophie starts

Run `node --env-file=.env --import tsx --import ./scripts/stub-server-only.mjs scripts/check-owner-voice-setup.ts` from Trade to inspect local session size, enabled visit tools and compatibility with the local sibling bridge whitelist. This uses fixture authentication and a mocked bridge; it never connects to OpenAI or reads customer records, and does not verify the installed remote bridge.

The bridge must be restarted after uploading `src/agents/trade/trade-owner-voice.mjs` into the checkout it actually runs. Job/inspection creation added new whitelisted tool names; an older running bridge can reject the entire session. The updated bridge supplies fixed diagnostic codes (`tool_whitelist`, `instructions_limit`, `bridge_authorization`, `realtime_rejected`) and Trade displays a corresponding message. Older bridges returning a bare 400 prompt an update/restart and validation check. Trade logs only the HTTP status and recognized diagnostic code, without tokens or request contents. A 401 means the shared secrets do not match; a Realtime rejection needs the upstream status from the bridge log.
