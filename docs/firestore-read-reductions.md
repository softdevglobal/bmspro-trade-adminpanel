# Firestore read reductions

## Local testing

Keep your current automation flags enabled. This change does not edit `.env`,
change cron schedules, or change callback retry/calling-hours rules.

- Missed callbacks: every 15 seconds locally.
- Scheduled and invoice callbacks: every minute locally.
- Calendar reminders: every five minutes locally.
- Reminder and CarePlus development ticks no longer overlap if a previous tick
  takes longer than the interval. This is per process, not a distributed lock.

Restart the local development server after updating worker code.

## Index rollout

The added indexes are `ai_scheduled_callbacks(status, scheduledAt)` and
`requests(scheduledSlot.date, status)`. Deploy the index configuration with:

```sh
npx firebase deploy --only firestore:indexes --project bmspro-trade
```

Review any CLI proposal to delete unrelated remote indexes; do not force deletion.
Wait for the indexes to finish building. No document migration is required for
these changes. The worker falls back to its previous query only when Firestore
reports a missing/building index. Other errors still surface normally.

The compatibility callback query retains its previous 500-document limit, so
the full savings and improved due-work selection require the index to be ready.

## What changed

- Scheduled callbacks query the earliest six due records instead of up to 500
  future/scheduled records. The existing transaction claim and six-call batch
  remain in place, as do retries, opt-out checks, and calling-hours checks.
- Inspection reminders filter `status == scheduled` on the server. Existing
  date, timezone, start-time fallback, and dispatch deduplication are unchanged.
- Missed-call processing reads current callback state before doing opt-out and
  resolution work for already resolved episodes. Opt-out is still checked before
  every eligible call; retry eligibility and transaction claims remain intact.
- Email-history and shared list polling pause while the browser tab is hidden
  and refresh when it becomes visible. Email delivery workers are unaffected.
- Business/customer notification triggers within 250ms merge into one refresh.
  An event received during a request schedules one trailing refresh so new
  activity is not lost. Customer list length changes no longer reconnect SSE
  or trigger another initial fetch. The two-minute fallback poll remains.

## Verify savings

Set `FIRESTORE_READ_METRICS=true` locally and restart to log returned-document
counts for scheduled-callback and reminder queries. These are diagnostic counts,
not billed reads: they exclude auth reads, transaction retries, index entries,
and other queries. No customer data is included. A fallback warning means the
optimized query is not active yet.

Additional labels report missed-callback mappings, callback-state lookups,
call opt-out lookups, recording ownership periods, and customer-name queries.
Point-lookup labels count a successfully requested document even if absent;
query labels count documents returned. This remains partial instrumentation,
not total Firestore billing: nested route/profile reads and transaction retries
are not fully counted. Yeastar call-history results are not Firestore reads.

Run the isolated regression tests without live Firebase credentials:

```sh
npx tsx --test scripts/test-firestore-read-reductions.ts
npx tsx --test scripts/test-coalesced-refresh.ts
```

Compare document counts and the Firebase hourly read graph under similar usage.
Also check whether another developer or deployed cron is polling the same project.

## Deliberately retained compatibility behavior

Job and personal-event reminders still scan the existing three-day date window.
Legacy jobs can have no status and still be considered scheduled by the mapper.
A due-time reminder queue needs a separate migration covering all creation,
reschedule, cancellation, recurring-job, and timezone-update paths before it can
replace these scans safely. No existing reminders are migrated or abandoned here.

Missed-call discovery still checks the full existing 24-hour PBX window. Moving
to a watermark requires durable retry state and handling late PBX records; this
change does not risk losing those calls to reduce scan frequency.

No production deployment, index deployment, or real outbound test call is part
of the local code changes.
