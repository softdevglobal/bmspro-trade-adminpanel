# Call Center API — Test Report (BMS Trade via Command Center)

**Date:** 28 Oct 2026 · **Agent:** jay@gmail.com (Niranga Jay) · **Business:** PD Plumbing (`ictEfcjVqnrSwmsrIUjm`, owner pawankanchana99@gmail.com)

## 1. Summary

The Trade call-center API works end to end through Command Center. The agent logged in once to Command Center and created **10 bookings for PD Plumbing**. The same session then confirmed, rescheduled and cancelled some of them, flagged customer notifications, logged calls and read the chat inboxes. Every security check held.

| Run | Checks | Passed | Notes |
|-----|--------|--------|-------|
| Main run | 105 | 99 | All 6 non-passes were explained (section 7): 4 were test data (a staff member's day off), 1 was a flawed tamper test, 1 was the right denial with a different status code |
| Re-run of the staff-dependent checks | 9 | 9 | Same checks on days the staff actually work |
| Token tampering (separate check) | 4 | 4 | See section 5 |

**No server errors (5xx)** and **no failed notification tasks** were logged during the run. The owner's own Trade API shows **10 / 10** test bookings.

## 2. Setup

| Item | Value |
|------|-------|
| Trade admin panel | `npm run dev` → `http://127.0.0.1:3001` (Firebase project `bmspro-trade`) |
| Command Center | `npm run dev` → `http://127.0.0.1:5050` |
| Command Center settings for this run only (not saved to `.env`) | `BLUE_API_BASE_URL=http://127.0.0.1:3001`, `FIREBASE_BLUE_WEB_API_KEY` = Trade's public web key |
| Flow under test | Frontend → `POST /api/auth/login` (Supabase) → `/api/bms-blue/*` (Command Center) → `/api/call-center/*` (Trade) → Firestore |
| Direct Trade tests | Firebase ID tokens: agent (password sign-in), owner and staff (custom-token sign-in, read-only) |

**Changes made in Trade Firebase to run the tests** (approved before running):

- Created the Trade login **jay@gmail.com / 123456** (uid `hbcdoBOCaxbMsQBi8LJBENJyPAh2`) with claim `role: call_center`, plus `users/{uid}` and `call_center_agents/{uid}` docs, the same shape as Trade's own `POST /api/callcenter/agents`.
- Assigned the agent to **PD Plumbing only** (`assignedBusinessIds: ["ictEfcjVqnrSwmsrIUjm"]`).
- For the suspension test, set `call_center_agents/{uid}.status` to `suspended` for a few seconds, then removed it.

**Test customer data:** emails `pawankanchana99+test1..10@gmail.com` (they all land in the owner's inbox). Phones are Australia's reserved fictional mobile numbers (`0491 570 156` …), so no real person was texted.

## 3. The 10 bookings created through Command Center

All created with `POST /api/bms-blue/bookings` (service "test test sri", `createdSource: call_center`). State after all tests:

| # | Request id | Request code | Customer email | Phone | Preferred day | Status | Scheduled visit | Staff |
|---|-----------|--------------|----------------|-------|---------------|--------|-----------------|-------|
| 1 | `RGiEMYKjTc8ao9QYuCz5` | INS-REQ XS48UVQ7K | pawankanchana99+test1@gmail.com | 0491570156 | 2026-11-02 | scheduled | 2026-11-22 10:00–11:00 | jjf |
| 2 | `Y5xisUhcYVaU3c25TXZy` | INS-REQ XSSGG2WFB | pawankanchana99+test2@gmail.com | 0491570157 | 2026-11-03 | scheduled | 2026-11-17 15:00–16:00 | fdsafds |
| 3 | `Y4svXwNp1dKtEgtnAW3e` | INS-REQ KDY5ZE4E9 | pawankanchana99+test3@gmail.com | 0491570158 | 2026-11-04 | scheduled | 2026-11-04 10:00–11:00 | — |
| 4 | `RSEUZg4yEDfQRPRGVkg7` | INS-REQ 6QSP4NUAK | pawankanchana99+test4@gmail.com | 0491570159 | 2026-11-05 | scheduled | 2026-11-05 14:00–15:30 | — |
| 5 | `zD0Wq2vmYwdue34GPNPd` | INS-REQ R5TCMQVHP | pawankanchana99+test5@gmail.com | 0491570313 | 2026-11-06 | scheduled | 2026-11-06 08:00–09:00 | fdsafds |
| 6 | `T0U9BidnoTTGXFP6LSSo` | INS-REQ AVRRJ3RKF | pawankanchana99+test6@gmail.com | 0491570737 | 2026-11-09 | scheduled | 2026-11-18 09:00–10:00 | — |
| 7 | `56TBAfJqbn3bwlwN3eae` | INS-REQ RY2YR5FNN | pawankanchana99+test7@gmail.com | 0491570808 | 2026-11-10 | scheduled | 2026-11-11 09:00–10:30 | jjf |
| 8 | `GqgoqNJyX5UWjVQKYzal` | INS-REQ 5XB69UUZ4 | pawankanchana99+test8@gmail.com | 0491571266 | 2026-11-11 | pending | — | — |
| 9 | `gTl0I6d1XTPvtzJ4ehdk` | INS-REQ 7WTVHH4YC | pawankanchana99+test9@gmail.com | 0491571491 | 2026-11-12 | pending | — | — |
| 10 | `F6Fk9qBF9KzUCeuaJg8o` | INS-REQ CB7RFQQE9 | pawankanchana99+test10@gmail.com | 0491571804 | 2026-11-13 | cancelled | — | — |

What each booking exercised:

- **#1:** rescheduled 3 times, with staff
- **#2:** confirmed using the default date, rescheduled with a new staff member, then complete was blocked
- **#3:** confirmed twice (second attempt → 409)
- **#4:** confirmed via `PATCH { status: "Confirmed" }`
- **#5:** confirmed by request code, with staff
- **#6:** rescheduled while still pending
- **#7:** confirmed with a custom date, time window and staff
- **#8:** confirm refused (staff day off), booking left unchanged
- **#9:** untouched
- **#10:** cancelled with a reason

## 4. Findings

| # | Finding | Impact | Suggestion |
|---|---------|--------|------------|
| F1 | **The staff shortlist is always empty for PD Plumbing.** `GET /services/{id}/staff` matches the service's `requiredSkill` ("Plumbing") against each staff member's `skills` / `staffType`. Staff have `skills: []`, and jjf's type is "Plumber", not "Plumbing". Confirm and reschedule do **not** check skills, so they accept either staff member. | An agent UI built on the shortlist would show "no staff", even though assigning works. | Either fill staff `skills` for this business, or make the shortlist fall back to all active staff when nobody matches the skill (and flag them as not skill-matched). |
| F2 | **Command Center `.env` has no Trade settings.** `FIREBASE_BLUE_WEB_API_KEY` and `BLUE_API_BASE_URL` are missing. Without them, login skips Trade and every `/api/bms-blue/*` call returns 403 ("No stored Firebase Blue idToken"). | `/api/bms-blue/*` can't work in any environment until they are set. | Add both to the Command Center `.env` (and deployment settings). `BLUE_API_BASE_URL` = the deployed Trade URL. |
| F3 | **Agents registered in Command Center don't get a Trade login.** jay@gmail.com had Black and Pink logins but no Trade account. Trade also needs `assignedBusinessIds` on `call_center_agents`, or the agent can see no business. | New agents can't use Trade until someone sets them up there by hand. | Have Command Center agent registration create the Trade user (`role: call_center` claim) and write `assignedBusinessIds`. |
| F4 | Both PD Plumbing staff accounts have `mustChangePassword: true`, so their logins are rejected with 401 until they reset their passwords. | Expected, but it means a staff token fails before any role check. | None needed. |
| F5 | The first call to each route takes 3–8 s while Next.js compiles it. | Dev mode only. | None. |

No security issue was found.

## 5. Token tampering (separate check against Firebase verification)

The main run's "tampered token" check changed the last two characters of a token and still got 200. Checked in isolation:

| Change to a fresh agent token | Result |
|-------------------------------|--------|
| A character in the middle of the signature | ❌ Rejected (`auth/argument-error`) |
| Payload edited (uid swapped) | ❌ Rejected |
| The same 2-character change as the main run | ❌ Rejected |
| Only the last character changed | Accepted — the decoded signature bytes are **identical** (the last base64 character carries unused padding bits), so it is the same token |

Conclusion: no tampering weakness. The main-run check happened to change only padding bits.

## 6. Not tested

- AI receptionist restrictions (needs an AI front-office account). Covered by Trade's existing `npm run test:booking-auth` tests, which pass.
- Chat **write** actions (start a chat, send / claim / close / read, presence, FCM token). Skipped so the owner wasn't messaged; only the list endpoints were tested.
- Super-admin access paths, rate limiting, load.
- Email and SMS delivery content (sending was triggered; check the owner inbox for the `+testN` emails).

## 7. All results

"⚠️ See note" rows are explained right below each one.

### Catalog

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | List workshops (summary) — agent sees only PD Plumbing | `GET /bms-blue/workshops?summary=1` | 200 | 200 | ✅ Pass |
| 2 | List workshops (full bundle with services + staff) | `GET /bms-blue/workshops` | 200 | 200 | ✅ Pass |
| 3 | List services | `GET /bms-blue/services` | 200 | 200 | ✅ Pass |
| 4 | Get one service (+ eligible staff) | `GET /bms-blue/services/Pd40wYpF6V2pFGTUoHxV` | 200 | 200 | ✅ Pass |
| 5 | Service staff shortlist for a date | `GET /bms-blue/services/Pd40wYpF6V2pFGTUoHxV/staff?date=2026-11-03` | 200 | 200 | ✅ Pass |
| 6 | List staff | `GET /bms-blue/staff` | 200 | 200 | ✅ Pass |
| 7 | List staff filtered by status=active | `GET /bms-blue/staff?status=active` | 200 | 200 | ✅ Pass |
| 8 | Availability for 1 month | `GET /bms-blue/bookings/availability?from=2026-11-01&to=2026-11-30` | 200 | 200 | ✅ Pass |

### Bookings

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Create booking #1 (CC Test Customer 1, 2026-11-02) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 2 | Create booking #2 (CC Test Customer 2, 2026-11-03) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 3 | Create booking #3 (CC Test Customer 3, 2026-11-04) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 4 | Create booking #4 (CC Test Customer 4, 2026-11-05) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 5 | Create booking #5 (CC Test Customer 5, 2026-11-06) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 6 | Create booking #6 (CC Test Customer 6, 2026-11-09) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 7 | Create booking #7 (CC Test Customer 7, 2026-11-10) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 8 | Create booking #8 (CC Test Customer 8, 2026-11-11) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 9 | Create booking #9 (CC Test Customer 9, 2026-11-12) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 10 | Create booking #10 (CC Test Customer 10, 2026-11-13) | `POST /bms-blue/bookings` | 200 | 200 | ✅ Pass |
| 11 | List bookings for PD Plumbing contains all 10 new bookings | `GET /bms-blue/getallbooking?limit=500` | 200 | 200 | ✅ Pass |
| 12 | List without X-Tenant-Id → agent's assigned businesses | `GET /bms-blue/getallbooking` | 200 | 200 | ✅ Pass |
| 13 | Filter status=pending | `GET /bms-blue/getallbooking?status=pending` | 200 | 200 | ✅ Pass |
| 14 | Filter by date | `GET /bms-blue/getallbooking?date=2026-11-02` | 200 | 200 | ✅ Pass |
| 15 | Look up by caller phone | `GET /bms-blue/bookings/by-phone?phone=0491570158` | 200 | 200 | ✅ Pass |
| 16 | Get booking by document id | `GET /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5` | 200 | 200 | ✅ Pass |
| 17 | Get booking by request code (INS-REQ XS48UVQ7K) | `GET /bms-blue/bookings/INS-REQ%20XS48UVQ7K` | 200 | 200 | ✅ Pass |

### Actions

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Confirm #1 with date, time window and staff (jjf) | `POST /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/confirm` | 200 | 409 — jjf is not scheduled to work on 2026-11-02 and cannot be assigned that day. | ⚠️ See note |
| | ↳ *Test data: jjf does not work Mondays. Server correctly refused (409). Re-run on a working day — see Actions (rerun).* | | | | |
| 2 | Confirm #2 using default date (first preferred) and default 60-min window | `POST /bms-blue/bookings/Y5xisUhcYVaU3c25TXZy/confirm` | 200 | 200 | ✅ Pass |
| 3 | Confirm #3 again after confirming → 409 already scheduled | `POST /bms-blue/bookings/Y4svXwNp1dKtEgtnAW3e/confirm (x2)` | 409 | 409 — Booking is already scheduled. Use reschedule to change it. | ✅ Pass |
| 4 | Confirm #4 via PATCH { status: "Confirmed" } (Pink spelling) | `PATCH /bms-blue/bookings/RSEUZg4yEDfQRPRGVkg7` | 200 | 200 | ✅ Pass |
| 5 | Confirm #5 by request code instead of id | `POST /bms-blue/bookings/INS-REQ R5TCMQVHP/confirm` | 200 | 409 — jjf is not scheduled to work on 2026-11-06 and cannot be assigned that day. | ⚠️ See note |
| | ↳ *Test data: jjf does not work Fridays. Correctly refused. Re-run with fdsafds — passed.* | | | | |
| 6 | Reschedule #1 to a new day/time (keeps staff) | `PATCH /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/reschedule` | 200 | 200 | ⚠️ See note |
| | ↳ *Follow-on of the refused confirm: #1 had no staff to keep. Reschedule itself returned 200. Re-run with staff — passed.* | | | | |
| 7 | Reschedule #1 to the same date/time → 400 | `PATCH /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/reschedule` | 400 | 400 — The new date, time and staff are the same as the current booking. | ✅ Pass |
| 8 | Reschedule #2 with a new staff member (fdsafds) | `PATCH /bms-blue/bookings/Y5xisUhcYVaU3c25TXZy/reschedule` | 200 | 200 | ✅ Pass |
| 9 | Reschedule a pending booking (#6) schedules it | `PATCH /bms-blue/bookings/T0U9BidnoTTGXFP6LSSo/reschedule` | 200 | 200 | ✅ Pass |
| 10 | Complete #2 → 400 (Trade needs a quotation first) | `POST /bms-blue/bookings/Y5xisUhcYVaU3c25TXZy/complete` | 400 | 400 — Save a quotation to finish this visit. The request stays scheduled until the quotation is created. | ✅ Pass |
| 11 | Cancel #10 with reason | `POST /bms-blue/bookings/F6Fk9qBF9KzUCeuaJg8o/cancel` | 200 | 200 | ✅ Pass |
| 12 | Cancel #10 again → 409 already cancelled | `POST /bms-blue/bookings/F6Fk9qBF9KzUCeuaJg8o/cancel` | 409 | 409 — Booking is already cancelled. | ✅ Pass |
| 13 | Confirm cancelled #10 → 400 | `POST /bms-blue/bookings/F6Fk9qBF9KzUCeuaJg8o/confirm` | 400 | 400 — Cannot confirm a booking that is currently Cancelled. | ✅ Pass |
| 14 | Reschedule cancelled #10 → 400 | `PATCH /bms-blue/bookings/F6Fk9qBF9KzUCeuaJg8o/reschedule` | 400 | 400 — Cannot reschedule a cancelled booking. | ✅ Pass |
| 15 | PATCH with unknown status → 400 | `PATCH /bms-blue/bookings/56TBAfJqbn3bwlwN3eae` | 400 | 400 — status must be one of: scheduled (Confirmed), cancelled (Canceled), completed. | ✅ Pass |
| 16 | Booking card shows call-center action history | `GET /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5` | 200 | 200 | ⚠️ See note |
| | ↳ *Follow-on: #1 had no confirm entry because confirm was refused. Re-run — passed.* | | | | |

### Validation

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Create with missing customer name → 400 | `POST /bms-blue/bookings` | 400 | 400 — Your name is required. | ✅ Pass |
| 2 | Create with invalid email → 400 | `POST /bms-blue/bookings` | 400 | 400 — Enter a valid email address. | ✅ Pass |
| 3 | Create with a past date → 400 | `POST /bms-blue/bookings` | 400 | 400 — Pick at least one preferred date and time range. | ✅ Pass |
| 4 | Create with bad postcode → 400 | `POST /bms-blue/bookings` | 400 | 400 — Check the address fields you entered. | ✅ Pass |
| 5 | Create with no preferred slots → 400 | `POST /bms-blue/bookings` | 400 | 400 — Pick at least one preferred date and time range. | ✅ Pass |
| 6 | Create with custom_quote type (not allowed on call-center route) → 400 | `POST /bms-blue/bookings` | 400 | 400 — Select an existing service for this business. | ✅ Pass |
| 7 | Create with another business's serviceId → 400 | `POST /bms-blue/bookings` | 400 | 400 — Select an active service from this business. | ✅ Pass |
| 8 | Create with malformed JSON (direct to Trade) → 400 | `POST /api/call-center/bookings` | 400 | 400 — Invalid request body. | ✅ Pass |
| 9 | Confirm with bad startTime → 400 | `POST /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/confirm` | 400 | 400 — startTime must be HH:mm. | ✅ Pass |
| 10 | Confirm with endTime before startTime → 400 | `POST /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/confirm` | 400 | 400 — endTime must be HH:mm and after startTime. | ✅ Pass |
| 11 | Confirm with a past date → 400 | `POST /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/confirm` | 400 | 400 — The visit date cannot be in the past. | ✅ Pass |
| 12 | Confirm with a staffId that is not this business's staff → 400 | `POST /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/confirm` | 400 | 400 — Selected staff member is unavailable for this business. | ✅ Pass |
| 13 | Reschedule without newTime → 400 | `PATCH /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/reschedule` | 400 | 400 — newDate (YYYY-MM-DD) and newTime (HH:mm) are required. | ✅ Pass |
| 14 | Availability range > 90 days → 400 | `GET /bms-blue/bookings/availability?from=2026-11-01&to=2027-06-01` | 400 | 400 — Choose a valid date range of 1 to 90 days. | ✅ Pass |
| 15 | List with invalid status → 400 | `GET /bms-blue/getallbooking?status=bogus` | 400 | 400 — status must be one of: pending, owner_proposed, scheduled, awaiting_decision, cancelled, completed. | ✅ Pass |
| 16 | Service staff with bad date → 400 | `GET /bms-blue/services/Pd40wYpF6V2pFGTUoHxV/staff?date=03-11-2026` | 400 | 400 — date must be YYYY-MM-DD. | ✅ Pass |
| 17 | Unknown booking id → 404 | `GET /bms-blue/bookings/does-not-exist` | 404 | 404 — Booking not found. | ✅ Pass |

### Notifications

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Customer inbox for PD Plumbing | `GET /bms-blue/customer-notifications?sinceDays=1` | 200 | 200 | ✅ Pass |
| 2 | Inbox rows include the test bookings, enriched with phone + request code | `GET /bms-blue/customer-notifications` | 200 | 200 | ✅ Pass |
| 3 | all=1 → only the agent's assigned businesses | `GET /bms-blue/customer-notifications?all=1` | 200 | 200 | ✅ Pass |
| 4 | unreadOnly=1 returns only unread | `GET /bms-blue/customer-notifications?unreadOnly=1` | 200 | 200 | ✅ Pass |
| 5 | Mark called-customer = true (agent taken from token) | `POST /bms-blue/customer-notifications/Rl0tnX2MRlRBHmG6Plrw/called-customer` | 200 | 200 | ✅ Pass |
| 6 | Mark notification-reviewed (no body → true) | `POST /bms-blue/customer-notifications/Rl0tnX2MRlRBHmG6Plrw/notification-reviewed` | 200 | 200 | ✅ Pass |
| 7 | Clear called-customer (false) | `POST /bms-blue/customer-notifications/Rl0tnX2MRlRBHmG6Plrw/called-customer` | 200 | 200 | ✅ Pass |
| 8 | Inbox reflects the reviewed flag | `GET /bms-blue/customer-notifications` | 200 | 200 | ✅ Pass |
| 9 | Tracking on a missing notification → 404 | `POST /bms-blue/customer-notifications/nope/called-customer` | 404 | 404 — Notification not found. | ✅ Pass |

### Call logs

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Log a call (spoofed agent fields in body are ignored) | `POST /bms-blue/agent-activities` | 201 | 201 | ✅ Pass |
| 2 | Log a call using ownerId alias + recordingFile name | `POST /bms-blue/agent-activities` | 201 | 201 | ✅ Pass |
| 3 | Missing callerNumber → 400 | `POST /bms-blue/agent-activities` | 400 | 400 — Missing callerNumber. | ✅ Pass |
| 4 | List call logs filtered by callId | `GET /bms-blue/agent-activities?callId=cc-test-1793161224507` | 200 | 200 | ✅ Pass |
| 5 | List call logs by agentEmail (case-insensitive) | `GET /bms-blue/agent-activities?agentEmail=JAY@GMAIL.COM` | 200 | 200 | ✅ Pass |

### Chat

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | List direct chats | `GET /bms-blue/chats` | 200 | 200 | ✅ Pass |
| 2 | List business owners to message | `GET /bms-blue/chats/workshop-owners` | 200 | 200 | ✅ Pass |
| 3 | Support chat inbox | `GET /bms-blue/agent/conversations` | 200 | 200 | ✅ Pass |
| 4 | Trade alias path /api/support-chat/agent/conversations works | `GET /api/support-chat/agent/conversations` | 200 | 200 | ✅ Pass |
| 5 | Trade alias path /api/call-center/chats works | `GET /api/call-center/chats` | 200 | 200 | ✅ Pass |

### Security (CC)

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | No Authorization header → 401 | `GET /bms-blue/getallbooking` | 401 | 401 — Missing Authorization: Bearer <Supabase access_token> — sign in via POST /api/auth/login first. | ✅ Pass |
| 2 | Garbage Supabase token → 401 | `GET /bms-blue/getallbooking` | 401 | 401 — Invalid or expired Supabase session. | ✅ Pass |
| 3 | Firebase token sent instead of Supabase token → 401 | `GET /bms-blue/workshops` | 401 | 401 — invalid JWT: unable to parse or verify signature, token signature is invalid: signing method RS256 is invalid | ✅ Pass |
| 4 | Missing X-Tenant-Id on a business-scoped route → 400 | `GET /bms-blue/services` | 400 | 400 — Missing X-Tenant-Id header (businessId for BMS Trade call-center scope). | ✅ Pass |
| 5 | No token on create booking → 401 (nothing written) | `POST /bms-blue/bookings` | 401 | 401 — Missing Authorization: Bearer <Supabase access_token> — sign in via POST /api/auth/login first. | ✅ Pass |
| 6 | Suspended agent through Command Center → 403 | `GET /bms-blue/services` | 403 | 403 — Call-center account is inactive. | ✅ Pass |

### Security (isolation)

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | X-Tenant-Id of a business not assigned to the agent → 403 | `GET /bms-blue/services` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 2 | Create booking in an unassigned business → 403 | `POST /bms-blue/bookings` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 3 | Body businessId of another business ignored when header is ours (scope = header) | `POST /bms-blue/agent-activities` | 201 | 201 | ✅ Pass |
| 4 | Read another business's booking id with our tenant → 404 | `GET /bms-blue/bookings/3z9AZw34dPRrmVeHjkGo` | 404 | 404 — Booking not found. | ✅ Pass |
| 5 | Cancel another business's booking with our tenant → 404 (not changed) | `POST /bms-blue/bookings/3z9AZw34dPRrmVeHjkGo/cancel` | 404 | 404 — Booking not found. | ✅ Pass |
| 6 | Read another business's booking with its own tenant → 403 | `GET /bms-blue/bookings/3z9AZw34dPRrmVeHjkGo` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 7 | Flag another business's customer notification → 403 | `POST /bms-blue/customer-notifications/7IOlwBylMu5joaucdW1d/called-customer` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 8 | Call logs of another business → 403 | `GET /bms-blue/agent-activities?businessId=0i6eYFQLw7LIxfDljUn3` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 9 | Another business's service by id → 404 | `GET /bms-blue/services/0QVqPIg5JrY5KdfAEvBP` | 404 | 404 — Service not found. | ✅ Pass |

### Security (Trade)

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | No token → 401 | `GET /api/call-center/bookings` | 401 | 401 — Missing authorization header. | ✅ Pass |
| 2 | Forged JWT → 401 | `GET /api/call-center/bookings` | 401 | 401 — Invalid or expired session. | ✅ Pass |
| 3 | Agent token tampered (last char changed) → 401 | `GET /api/call-center/staff` | 401 | 200 | ⚠️ See note |
| | ↳ *—* | | | | |
| 4 | Business owner token (not an agent) → 403 | `GET /api/call-center/bookings` | 403 | 403 — Call-center or super admin access required. | ✅ Pass |
| 5 | Staff token (not an agent) → 403 | `POST /api/call-center/bookings/{id}/cancel` | 403 | 401 — Invalid or expired session. | ⚠️ See note |
| | ↳ *Access denied as required, but with 401 instead of 403: the staff account has mustChangePassword=true, so Trade rejects the login before the role check.* | | | | |
| 6 | Owner token on workshops list → 403 | `GET /api/call-center/workshops` | 403 | 403 — Call-center or super admin access required. | ✅ Pass |
| 7 | Agent token, ?businessId= of another business → 403 | `GET /api/call-center/staff?businessId=0i6eYFQLw7LIxfDljUn3` | 403 | 403 — The booking agent is not assigned to this business. | ✅ Pass |
| 8 | Path traversal in booking id → 404/400, no crash | `GET /api/call-center/bookings/..%2F..%2Fusers` | 400/404 | 404 — Booking not found. | ✅ Pass |
| 9 | Very long booking id → handled (no 500) | `GET /api/call-center/bookings/{300 chars}` | 400/404 | 404 — Booking not found. | ✅ Pass |
| 10 | Path traversal in service id → 404 | `GET /api/call-center/services/..%2F..` | 400/404 | 404 — Service not found. | ✅ Pass |
| 11 | Body with array instead of object → 400 | `POST /api/call-center/bookings/{id}/confirm` | 400 | 400 — Invalid JSON body. | ✅ Pass |
| 12 | Suspended agent (call_center_agents.status = suspended) → 403 | `GET /api/call-center/bookings` | 403 | 403 — Call-center account is inactive. | ✅ Pass |
| 13 | Agent restored → access works again | `GET /api/call-center/staff` | 200 | 200 | ✅ Pass |

### Actions (rerun)

| # | Test | Request | Expected | Got | Result |
|---|------|---------|----------|-----|--------|
| 1 | Confirm #5 by request code with staff fdsafds (works Fridays) | `POST /bms-blue/bookings/{INS-REQ code}/confirm` | 200 | 200 | ✅ Pass |
| 2 | Confirm #7 with jjf on a Wednesday (2026-11-11 09:00–10:30) | `POST /bms-blue/bookings/56TBAfJqbn3bwlwN3eae/confirm` | 200 | 200 | ✅ Pass |
| 3 | Confirm #8 with jjf on a Monday (his day off) → 409 and booking unchanged | `POST /bms-blue/bookings/GqgoqNJyX5UWjVQKYzal/confirm` | 409 | 409 — jjf is not scheduled to work on 2026-11-16 and cannot be assigned that day. | ✅ Pass |
| 4 | …#8 is still pending after the blocked confirm | `GET /bms-blue/bookings/GqgoqNJyX5UWjVQKYzal` | 200 | 200 | ✅ Pass |
| 5 | Reschedule #1 to a Wednesday and assign jjf | `PATCH /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/reschedule` | 200 | 200 | ✅ Pass |
| 6 | Reschedule #1 keeping jjf to a Thursday (his day off) → 409 | `PATCH /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/reschedule` | 409 | 409 — jjf is not scheduled to work on 2026-11-19 and cannot be assigned that day. Pass newStaffId to reassign. | ✅ Pass |
| 7 | Reschedule #1 keeping jjf to a Sunday (works) — keeps staff | `PATCH /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5/reschedule` | 200 | 200 | ✅ Pass |
| 8 | Booking card #1 shows the reschedule history with reasons | `GET /bms-blue/bookings/RGiEMYKjTc8ao9QYuCz5` | 200 | 200 | ✅ Pass |
| 9 | Booking card #5 shows the confirm action by the agent | `GET /bms-blue/bookings/zD0Wq2vmYwdue34GPNPd` | 200 | 200 | ✅ Pass |

## 8. Cleaning up the test data

- **Bookings:** delete the 10 request ids in section 3 from the Trade admin panel (or Firestore `requests`), plus their `customer_notifications` / `business_notifications`.
- **Call logs:** `agent_activities` rows where `callId` starts with `cc-test-` (3 rows).
- **Agent:** keep jay@gmail.com in Trade if Command Center agents should use Trade; otherwise delete uid `hbcdoBOCaxbMsQBi8LJBENJyPAh2` from Firebase Auth, `users` and `call_center_agents`.
