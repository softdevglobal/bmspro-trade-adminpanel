# Sophie calendar

Owners can enable **Calendar → Filters → Sophie calendar**, then select overdue invoice follow-ups, quotation follow-ups and scheduled calls. It is off initially. Activities appear in Month, Week and Today, with recipient, reference, status and business-local time in the day detail. Use **Refresh Sophie** after queuing or completing a call.

The calendar reads saved automation records; opening it never queues, reschedules or places a call. Invoice queue times represent when the follow-up was queued or attempted, not a guaranteed future dial time. Calling hours, opt-outs, permissions and worker capacity still apply. Payment due dates remain a separate calendar option.

## Deployment

From the Trade repository, deploy the indexes and wait until Firebase reports them ready:

```powershell
npx firebase deploy --only firestore:indexes --project bmspro-trade
```

Then deploy/restart Trade with these changes. No voice bridge upload or environment changes are needed.

## Data and access

`GET /api/calendar/sophie?from=YYYY-MM-DD&to=YYYY-MM-DD` uses an exclusive `to` date and a maximum 62-day range. It requires the current business owner, an active business, and a rate limit. Every query is tenant-bound, date-bound and capped at 100 records per source. Truncation is visible; use Today or Week to narrow the range. No full-collection fallback or polling is used.

- Scheduled calls: `ai_scheduled_callbacks.scheduledAt`, including owner notifications and owner-requested customer calls.
- Quotation follow-ups: enabled quotations with a saved `sophieFollowUpDueAt`.
- Invoice follow-ups: `ai_invoice_call_attempts.attemptedAt`, enriched only from invoices in the same business. Scheduled invoice callbacks appear from the scheduled-call source to avoid duplication.

To add a future activity category, extend `SOPHIE_CALENDAR_TYPES` in `lib/calendar/sophie-events.ts`, provide a tenant/date-bound adapter in the server loader and add any required index. The filter list renders from the registry. Sophie activities never reserve visit capacity or change job/inspection statistics.

## Offline validation

```powershell
npx tsx --import ./scripts/stub-server-only.mjs --test scripts/test-sophie-calendar.ts scripts/test-invoice-due-calendar.ts
npx tsc --noEmit
```

For a UI check, enable the filter, open a day containing an existing queued follow-up, switch categories and views, and follow its record link. Switch the filter off to hide all Sophie activities.
