# Call Center API — BMS Trade

Every call-center API in the Trade admin panel, with request and response bodies.

- **Part A** — conventions, auth, login
- **Part B** — `/api/call-center/*` (workshops, staff, services, bookings, customer notifications, call logs)
- **Part C** — chat (`/api/call-center/chats/*`, `/api/chats/cc/*`, `/api/support-chat/agent/*`)
- **Part D** — older `/api/callcenter/*` routes
- **Part E** — Command Center proxy (`/api/bms-blue/*`) mapping

The `/api/call-center/*` folder layout matches BMS Pink (`bmspro-pink-adminpanel/app/api/call-center`). Differences from Pink are listed in section 13.

---

# Part A — Conventions

## 1. Base URL, headers, tenant

| Item | Value |
|------|-------|
| Local base URL | `http://localhost:3001` (`npm run dev`) |
| Auth header | `Authorization: Bearer <Firebase ID token>` (project bmspro-trade) |
| Tenant | `X-Tenant-Id: <businessId>` header, or `?businessId=` query, or `businessId` in a JSON body. `?tenantId=` / `?ownerUid=` are also accepted. |
| Content type | `Content-Type: application/json` for bodies |
| Timestamps | Bookings, services, staff, notifications: epoch **milliseconds**. Call logs: ISO strings. |

A **tenant** on Trade is a business: `businesses/{businessId}`.

## 2. Who can call

| Caller | How it is recognised | Access |
|--------|---------------------|--------|
| Call-center agent | token claim `role: "call_center"` and an active `call_center_agents/{uid}` (or `users/{uid}`) profile | Only businesses in `call_center_agents/{uid}.assignedBusinessIds` or `workshopOwnerUid` |
| Super admin | claim `superAdmin` / `role: "super_admin"` or an active `super_admins/{uid}` doc | Every business |
| AI receptionist | claims `role: "ai_receptionist"`, `aiFrontOffice: true`, `brand: "trade"` | Its one business. **Read and create only**: cannot confirm, cancel, complete, reschedule or flag notifications |

The business must not be suspended or inactive, otherwise `403 This business is unavailable.`

## 3. Error shape

Every error is:

```json
{ "ok": false, "error": "Human readable message." }
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error, missing tenant, business rule (e.g. cannot complete) |
| 401 | `Missing authorization header.` / `Invalid or expired session.` |
| 403 | Not an agent, business not assigned to the agent, business unavailable, AI not allowed |
| 404 | Not found (also returned for records of another business) |
| 409 | Conflict: already in that status, staff on leave/off day, duplicate request code |
| 500 | Server error |

Common tenant/auth errors on every business-scoped route:

```json
{ "ok": false, "error": "Missing businessId (X-Tenant-Id header or ?businessId=)." }
{ "ok": false, "error": "The booking agent is not assigned to this business." }
{ "ok": false, "error": "This business is unavailable." }
{ "ok": false, "error": "The AI receptionist cannot perform this action." }
```

## 4. Login — `POST /api/callcenter/auth/login`

Gets a Firebase ID token for an agent or super admin. The token lasts 1 hour.

**Request**
```json
{ "email": "sarah.johnson@callcenter.com", "password": "Agent@1234" }
```

**Response 200**
```json
{
  "ok": true,
  "idToken": "<Firebase ID token>",
  "uid": "abc123xyz789",
  "email": "sarah.johnson@callcenter.com",
  "isSuperAdmin": false,
  "fullName": "Sarah Johnson",
  "extension": "1001",
  "agentType": "command-centre"
}
```

**Errors:** `400 Email and password are required.`, `401` wrong credentials, `403` not an agent / inactive.

---

# Part B — `/api/call-center/*`

## 5. Route map

```
app/api/call-center/
├── workshops/route.ts                         GET
├── staff/route.ts                             GET
├── services/route.ts                          GET
├── services/[serviceId]/route.ts              GET
├── services/[serviceId]/staff/route.ts        GET
├── bookings/route.ts                          GET (list), POST (create)
├── bookings/availability/route.ts             GET
├── bookings/[id]/route.ts                     GET, PATCH, PUT
├── bookings/[id]/confirm/route.ts             POST
├── bookings/[id]/cancel/route.ts              POST
├── bookings/[id]/complete/route.ts            POST
├── bookings/[id]/reschedule/route.ts          PATCH
├── customer-notifications/route.ts            GET
├── customer-notifications/[notificationId]/called-customer/route.ts        POST
├── customer-notifications/[notificationId]/notification-reviewed/route.ts  POST
├── agent-activities/route.ts                  GET, POST
└── chats/…                                    see Part C

lib/callcenter/
├── tenant.ts                      tenant + auth (requireCallCenterTenant), helpers
├── booking-access.ts              token + business scope check
├── bookings.ts                    lookup, list, confirm/cancel/complete, reschedule
├── booking-routes.ts              shared route handlers for bookings/[id]/*
├── catalog.ts                     workshops, staff, services, service staff
├── customer-notifications.ts      customer inbox + tracking flags
├── notification-tracking-route.ts shared handler for the tracking routes
└── agent-activities.ts            call logs
```

---

## 6. Workshops (businesses)

### 6.1 `GET /api/call-center/workshops`

Businesses the caller can work with. Super admin → every business (max 500). Agent → its assigned businesses. Suspended / inactive businesses are left out. No tenant needed. Not available to the AI receptionist.

| Query | Notes |
|-------|-------|
| `summary=1` | Business details only. Default is the full bundle (business + active services + staff). |

**Response 200 (`summary=1`)**
```json
{
  "ok": true,
  "total": 1,
  "workshops": [
    {
      "businessId": "biz001",
      "name": "Ace Plumbing Services",
      "email": "info@aceplumbing.com.au",
      "phone": "+61412345678",
      "businessType": "plumbing",
      "address": "12 Example St, Melbourne VIC 3000",
      "state": "VIC",
      "postcode": "3000",
      "mainSuburb": "Melbourne",
      "serviceAreas": ["Melbourne CBD", "South Yarra"],
      "bookingSlug": "ace-plumbing",
      "timezone": "Australia/Melbourne",
      "status": "active",
      "isActive": true
    }
  ]
}
```

**Response 200 (full bundle)**
```json
{
  "ok": true,
  "total": 1,
  "workshops": [
    {
      "workshop": { "...same as summary row" },
      "services": [ { "...service object (8.1)" } ],
      "staff": [ { "...staff object (7.1)" } ]
    }
  ]
}
```

**Errors:** `401`, `403 Call-center or super admin access required.`, `500 Could not fetch workshops.`

---

## 7. Staff

### 7.1 `GET /api/call-center/staff`

Staff (`users` with `role: "staff"`) of the business, sorted by name.

| Query | Required | Notes |
|-------|----------|-------|
| tenant | yes | `X-Tenant-Id` or `?businessId=` |
| `status` | no | e.g. `active`, `inactive` (case-insensitive) |

**Response 200**
```json
{
  "ok": true,
  "businessId": "biz001",
  "total": 1,
  "staff": [
    {
      "id": "staffUid1",
      "uid": "staffUid1",
      "fullName": "Tom Fitter",
      "email": "tom@aceplumbing.com.au",
      "phone": "+61400111222",
      "staffType": "plumber",
      "skills": ["plumbing", "gas fitting"],
      "status": "active",
      "photoUrl": null,
      "createdAt": 1716000000000
    }
  ]
}
```

---

## 8. Services

### 8.1 `GET /api/call-center/services`

Bookable services of the business. Use `services[].id` as `serviceId` when creating a booking.

| Query | Required | Notes |
|-------|----------|-------|
| tenant | yes | |
| `activeOnly` | no | default `true`; pass `false` to include inactive services |

**Response 200**
```json
{
  "ok": true,
  "businessId": "biz001",
  "total": 1,
  "services": [
    {
      "id": "svc001",
      "businessId": "biz001",
      "templateId": null,
      "name": "Blocked drain inspection",
      "businessType": "plumbing",
      "requiredSkill": "plumbing",
      "defaultDurationMin": 60,
      "isActive": true,
      "imageUrl": null,
      "taskCount": 1,
      "tasks": [
        {
          "id": "task001",
          "serviceId": "svc001",
          "title": "Camera inspection",
          "description": "Run the camera through the main line.",
          "isRequired": true,
          "photoRequired": true,
          "customerVisible": false,
          "sortOrder": 0
        }
      ],
      "createdAt": 1716000000000,
      "updatedAt": 1716100000000
    }
  ]
}
```

### 8.2 `GET /api/call-center/services/{serviceId}`

One service plus the staff who can take it (no date filter).

**Response 200**
```json
{
  "ok": true,
  "service": {
    "...service object (8.1)",
    "staff": [ { "...staff object (7.1)", "availableOnDate": null } ]
  }
}
```

**Errors:** `404 Service not found.` (also for another business's service).

### 8.3 `GET /api/call-center/services/{serviceId}/staff`

Shortlist of staff who can take the service.

| Query | Required | Notes |
|-------|----------|-------|
| tenant | yes | |
| `date` | no | `YYYY-MM-DD`. Removes staff on approved leave or a weekly off day that day. |

**Who is eligible:** active staff; if the service lists `staffIds` or a `requiredSkill`, only staff matching it (by `staffIds`, the staff's `serviceIds`, `skills` or `staffType`); otherwise every active staff member.

**Response 200**
```json
{
  "ok": true,
  "service": {
    "id": "svc001",
    "name": "Blocked drain inspection",
    "requiredSkill": "plumbing",
    "defaultDurationMin": 60
  },
  "filter": { "date": "2026-11-03" },
  "total": 1,
  "staff": [ { "...staff object (7.1)", "availableOnDate": true } ]
}
```

`availableOnDate` is `null` when no `date` is passed.

**Errors:** `400 date must be YYYY-MM-DD.`, `404 Service not found.`

---

## 9. Bookings

On Trade a call-center **booking is an inspection request** (`requests` collection). The agent creates it, then the business (or the agent) schedules a visit.

**Statuses**

| Status | Meaning |
|--------|---------|
| `pending` | New, waiting for the business to pick a date |
| `owner_proposed` | Business proposed other dates, waiting for the customer |
| `scheduled` | Visit date and time window set |
| `awaiting_decision` | Visit done, waiting on the quote decision |
| `cancelled` | Cancelled |
| `completed` | Finished |

`{id}` in the routes below can be the document id **or** the request code, e.g. `INS-REQ 4K7H2M9P` (URL-encode the space as `%20`).

### Booking object

Returned by list, detail and every action route.

```json
{
  "id": "req_8f2k1",
  "businessId": "biz001",
  "status": "scheduled",
  "statusLabel": "Scheduled",
  "requestType": "existing_service",
  "serviceId": "svc001",
  "serviceName": "Blocked drain inspection",
  "serviceBusinessType": "plumbing",
  "customRequest": null,
  "customer": {
    "fullName": "Sarah Mendis",
    "email": "sarah@example.com",
    "phone": "0400111222"
  },
  "customerId": null,
  "createdSource": "call_center",
  "requestCode": "INS-REQ 4K7H2M9P",
  "address": { "street": "5 Short St", "suburb": "Richmond", "state": "VIC", "postcode": "3121" },
  "preferredSlots": [ { "date": "2026-11-03", "timeRange": "morning" } ],
  "ownerProposedSlots": [],
  "jobPreferredSlots": [],
  "adminJobPreferredSlots": [],
  "jobProposedSlots": [],
  "customerAcceptedJobSlot": null,
  "scheduledSlot": { "date": "2026-11-03", "timeRange": "morning" },
  "scheduledStartTime": "09:30",
  "scheduledEndTime": "10:30",
  "assignedTo": {
    "type": "staff",
    "uid": "staffUid1",
    "name": "Tom Fitter",
    "email": "tom@aceplumbing.com.au"
  },
  "aiAssignment": null,
  "ownerNote": null,
  "customerNotes": "Water backing up in the laundry.",
  "budgetAud": 300,
  "customerImageUrls": [],
  "createdAt": 1761980000000,
  "updatedAt": 1761990000000,
  "cancelledAt": null,
  "visitStartedAt": null,
  "visitEndedAt": null,
  "quotation": null,
  "invoice": null,
  "bookingId": null,
  "bookingCode": null,
  "bookingStatus": null,
  "bookingStatusAt": null,
  "estimatedDurationMinutes": null,
  "bookingConfirmedAt": null
}
```

- `timeRange` is `morning` or `afternoon`.
- `bookingId` / `bookingCode` are the **job** created later from this visit (not the request itself).
- `assignedTo.type` is `staff` or `owner`.

### 9.1 `GET /api/call-center/bookings` — list

Newest first.

| Query | Notes |
|-------|-------|
| tenant | Optional. With it → that business. Without it → every business assigned to the agent. Super admins must pass a tenant (`400`). |
| `status` | One of the statuses above (`400` otherwise) |
| `date` | `YYYY-MM-DD`. Matches the scheduled day or any preferred / proposed day. |
| `phone` | Matches the last 9 digits of the customer phone |
| `createdSource` | e.g. `call_center`, `booking_engine` |
| `limit` | default `100`, range 1–500 |
| `all` | `1` / `true` → limit 500 |

**Response 200**
```json
{ "ok": true, "bookings": [ { "...booking object" } ], "total": 1 }
```

**Errors:** `400 status must be one of: …`, `400 date must be YYYY-MM-DD.`, `401`, `403`.

### 9.2 `POST /api/call-center/bookings` — create

Creates an inspection request for an existing service of the business. Saved with `createdSource: "call_center"`. Customer and business notifications are sent after the response.

**Request**
```json
{
  "businessId": "biz001",
  "requestType": "existing_service",
  "serviceId": "svc001",
  "customer": {
    "fullName": "Sarah Mendis",
    "email": "sarah@example.com",
    "phone": "0400 111 222"
  },
  "address": {
    "street": "5 Short St",
    "suburb": "Richmond",
    "state": "VIC",
    "postcode": "3121"
  },
  "preferredSlots": [
    { "date": "2026-11-03", "timeRange": "morning" },
    { "date": "2026-11-04", "timeRange": "afternoon" }
  ],
  "customerNotes": "Water backing up in the laundry.",
  "budgetAud": 300,
  "customerImageUrls": []
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `businessId` | yes | or `X-Tenant-Id` |
| `requestType` | yes | must be `existing_service` on this route |
| `serviceId` | yes | an **active** service of this business |
| `customer.fullName` | yes | |
| `customer.email` | yes | valid email |
| `customer.phone` | yes | digits are kept, spaces removed |
| `address.suburb`, `address.postcode` | yes | postcode must be 4 digits; `street`, `state` optional |
| `preferredSlots` | yes | 1–3 items, `date` today or later (business timezone), `timeRange` `morning` / `afternoon`. Each slot must be free (see 9.3). |
| `customerNotes` | no | max 2000 characters |
| `budgetAud` | no | number or string, e.g. `300` or `"$300"` |
| `customerImageUrls` | no | up to 5 URLs |
| `aiAutoAssignStaff` | no | AI receptionist only; needs `AI_AUTO_ASSIGN_STAFF_ENABLED=true` and the business's `sophieBookingAuthority` |

**Response 200**
```json
{
  "ok": true,
  "requestId": "req_8f2k1",
  "status": "pending",
  "confirmed": false
}
```

When the AI receptionist auto-assigns, `status` can be `scheduled`, `confirmed` is `true`, and a `staffAssignment` object is added:

```json
{
  "ok": true,
  "requestId": "req_8f2k1",
  "status": "scheduled",
  "confirmed": true,
  "staffAssignment": {
    "status": "assigned",
    "reason": "Matched plumbing skill.",
    "assignedBy": "sophie",
    "proposedSlot": { "date": "2026-11-03", "timeRange": "morning", "startTime": "09:00", "endTime": "10:00" }
  }
}
```

**Errors (400):** `Invalid request body.`, `Your name is required.`, `Enter a valid email address.`, `Mobile number is required.`, `Enter the site suburb and a 4-digit postcode.`, `Pick at least one preferred date and time range.`, `Select an existing service for this business.`, `Select an active service from this business.`, or a slot message such as `Tue, 3 Nov (morning) is not available. Please choose another date or time.`

### 9.3 `GET /api/call-center/bookings/availability`

Morning / afternoon sessions that **cannot** be booked in a date range (past, closed day, team unavailable or capacity full).

| Query | Required | Notes |
|-------|----------|-------|
| tenant | yes | |
| `from` | yes | `YYYY-MM-DD` |
| `to` | yes | `YYYY-MM-DD`; range 1–90 days |

**Response 200**
```json
{
  "ok": true,
  "unavailable": [
    { "date": "2026-11-03", "timeRange": "morning" },
    { "date": "2026-11-08", "timeRange": "afternoon" }
  ]
}
```

Any session not listed is free.

**Errors:** `400 Choose a valid date range of 1 to 90 days.`

### 9.4 `GET /api/call-center/bookings/{id}` — booking card

**Response 200**
```json
{
  "ok": true,
  "booking": { "...booking object" },
  "callCenterActions": [
    {
      "action": "confirm",
      "byUid": "agentUid1",
      "byName": "Sarah Johnson",
      "byEmail": "sarah.johnson@callcenter.com",
      "isAi": false,
      "previousStatus": "pending",
      "at": 1761990000000
    }
  ]
}
```

`callCenterActions` lists every confirm / cancel / complete / reschedule done through these APIs.

**Errors:** `404 Booking not found.`, `409 Multiple bookings match this request code.`

### 9.5 `POST /api/call-center/bookings/{id}/confirm`

Schedules the visit: `pending` / `owner_proposed` → `scheduled`. Not available to the AI receptionist.

**Request**
```json
{
  "date": "2026-11-03",
  "startTime": "09:30",
  "endTime": "10:30",
  "staffId": "staffUid1",
  "note": "Customer asked for a call 15 min before."
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `startTime` | yes | `HH:mm` (alias `time`) |
| `date` | no | `YYYY-MM-DD`, today or later. Default: the customer's first preferred day (first proposed day when `owner_proposed`). |
| `endTime` | no | `HH:mm`, after `startTime`. Default: `startTime + durationMinutes`. |
| `durationMinutes` | no | default `60`; used only when `endTime` is missing |
| `timeRange` | no | `morning` / `afternoon`; default from `startTime` (before 12:00 = morning) |
| `staffId` | no | assigns this staff member after scheduling. Must be active staff of the business, not on leave or off that day. |
| `note` | no | saved as the owner note |

**Response 200**
```json
{
  "ok": true,
  "bookingId": "req_8f2k1",
  "requestCode": "INS-REQ 4K7H2M9P",
  "previousStatus": "pending",
  "status": "scheduled",
  "action": "confirm",
  "booking": { "...booking object" }
}
```

**Errors**

| Status | Error |
|--------|-------|
| 400 | `startTime must be HH:mm.` / `endTime must be HH:mm and after startTime.` / `date must be YYYY-MM-DD.` / `The visit date cannot be in the past.` |
| 400 | `Cannot confirm a booking that is currently Cancelled.` (any status other than pending / owner_proposed / scheduled) |
| 400 | `This business is closed on the selected date. …` / `One or more time slots in that range are full for inspection requests. …` |
| 400 | `Selected staff member is unavailable for this business.` |
| 409 | `Booking is already scheduled. Use reschedule to change it.` |
| 409 | `Tom Fitter has approved time off on 2026-11-03 and cannot be assigned that day.` (also pending leave / not working that day) |

### 9.6 `POST /api/call-center/bookings/{id}/cancel`

**Request (optional)**
```json
{ "reason": "Customer no longer needs it" }
```

`reason` is saved as the owner note and in `callCenterActions`. The customer is notified.

**Response 200** — same envelope as 9.5 with `"status": "cancelled"`, `"action": "cancel"`.

**Errors:** `409 Booking is already cancelled.`, `400 Cannot cancel a booking that is currently Completed.`

### 9.7 `POST /api/call-center/bookings/{id}/complete`

**Request:** none (optional `{ "note": "…" }`).

Trade only finishes a visit once a quotation is saved, so this normally returns:

```json
{
  "ok": false,
  "error": "Save a quotation to finish this visit. The request stays scheduled until the quotation is created."
}
```

**Errors:** `409 Booking is already completed.`, `400 Cannot complete a booking that is currently Cancelled.`

### 9.8 `PATCH` / `PUT /api/call-center/bookings/{id}` — status change

Runs the same handler as 9.5–9.7.

**Request**
```json
{ "status": "scheduled", "startTime": "09:30", "endTime": "10:30" }
```

| `status` value | Same as |
|----------------|---------|
| `scheduled` or `Confirmed` | confirm (9.5) — include its fields |
| `cancelled` or `Canceled` | cancel (9.6) — optional `reason` |
| `completed` or `Completed` | complete (9.7) |

**Response 200** — same envelope as 9.5.
**Errors:** `400 status must be one of: scheduled (Confirmed), cancelled (Canceled), completed.` plus those of the matching action.

### 9.9 `PATCH /api/call-center/bookings/{id}/reschedule`

Moves the visit to a new date / time and optionally a new staff member. Works on `pending`, `owner_proposed` and `scheduled` requests (the first two become `scheduled`).

**Request**
```json
{
  "newDate": "2026-11-04",
  "newTime": "13:00",
  "newEndTime": "14:00",
  "reason": "Customer at work on Tuesday",
  "newStaffId": "staffUid2"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `newDate` | yes | `YYYY-MM-DD`, today or later |
| `newTime` | yes | `HH:mm` (alias `newStartTime`) |
| `newEndTime` | no | default: keeps the current visit length (60 min if not scheduled yet) |
| `timeRange` | no | default from `newTime` |
| `reason` | no | stored in `callCenterActions` |
| `newStaffId` | no | reassigns the visit. Without it, the current staff member must be free on the new day. |

**Response 200**
```json
{
  "ok": true,
  "bookingId": "req_8f2k1",
  "requestCode": "INS-REQ 4K7H2M9P",
  "status": "scheduled",
  "date": "2026-11-04",
  "startTime": "13:00",
  "endTime": "14:00",
  "staffId": "staffUid2",
  "staffName": "Mia Swift",
  "previous": {
    "date": "2026-11-03",
    "startTime": "09:30",
    "endTime": "10:30",
    "staffId": "staffUid1",
    "staffName": "Tom Fitter"
  },
  "booking": { "...booking object" }
}
```

**Errors**

| Status | Error |
|--------|-------|
| 400 | `newDate (YYYY-MM-DD) and newTime (HH:mm) are required.` |
| 400 | `Cannot reschedule a cancelled booking.` / `… completed booking.` |
| 400 | `The new date, time and staff are the same as the current booking.` |
| 400 | business closed / slots full (same as 9.5) |
| 409 | `This visit has already been started by staff and can no longer be rescheduled. Cancel it instead.` |
| 409 | `Tom Fitter has approved time off on 2026-11-04 and cannot be assigned that day. Pass newStaffId to reassign.` |

---

## 10. Customer notifications

The customer inbox is Trade's `customer_notifications` collection (what customers see in the portal). Agents use it to follow up by phone. Rows are enriched with the request's code, service and customer phone. Not available to the AI receptionist.

### Notification object

```json
{
  "id": "notif001",
  "audience": "customer",
  "businessId": "biz001",
  "customerId": null,
  "customerEmail": "sarah@example.com",
  "requestId": "req_8f2k1",
  "bookingSlug": "ace-plumbing",
  "businessName": "Ace Plumbing Services",
  "customerName": "Sarah Mendis",
  "status": "scheduled",
  "type": "request_scheduled",
  "title": "Inspection scheduled",
  "body": "Your inspection is booked for Tue 3 Nov, 9:30–10:30.",
  "read": false,
  "createdAt": 1761990000000,
  "requestCode": "INS-REQ 4K7H2M9P",
  "serviceName": "Blocked drain inspection",
  "customerPhone": "0400111222",
  "calledCustomer": false,
  "calledCustomerAt": null,
  "calledCustomerByUid": null,
  "calledCustomerByName": null,
  "calledCustomerByEmail": null,
  "notificationReviewed": false,
  "notificationReviewedAt": null,
  "notificationReviewedByUid": null,
  "notificationReviewedByName": null,
  "notificationReviewedByEmail": null
}
```

- `read` is the customer's own read flag.
- `type` is one of `request_created`, `request_scheduled`, `request_proposed`, `request_cancelled`, `request_completed`, `request_assigned`, `visit_on_the_way`, `booking_on_the_way`, `job_completed`, `invoice_sent`, `quotation_sent`, `quotation_accepted`, `quotation_rejected`, `system_message`, ….

### 10.1 `GET /api/call-center/customer-notifications`

| Query | Notes |
|-------|-------|
| tenant | Required unless `all=1` |
| `all=1` (or `scope=all`) | Agent → every assigned business. Super admin → platform-wide. |
| `unreadOnly=1` | Only rows the customer has not read |
| `limit` | default `50`, range 1–200 |
| `sinceDays` | default `14`, range 1–90 |

**Response 200 (one business)**
```json
{
  "ok": true,
  "scope": "business",
  "businessId": "biz001",
  "notifications": [ { "...notification object" } ],
  "total": 1,
  "unreadCount": 1,
  "unreadOnly": false,
  "limit": 50,
  "sinceDays": 14
}
```

**Response 200 (`all=1`)**
```json
{
  "ok": true,
  "scope": "all",
  "scopedToBusinesses": ["biz001", "biz002"],
  "notifications": [ { "...notification object" } ],
  "total": 1,
  "unreadCount": 1,
  "unreadOnly": false,
  "limit": 50,
  "sinceDays": 14
}
```

`scopedToBusinesses` is `null` for super admins.

**Errors:** `400 Missing businessId (X-Tenant-Id header or ?businessId=), or pass all=1.`, `401`, `403`, `500 Failed to fetch customer notifications.`

### 10.2 `POST /api/call-center/customer-notifications/{notificationId}/called-customer`

Marks that an agent called the customer about this notification. The agent comes from the token, never the body. The agent must have access to the notification's business.

**Request (optional)**
```json
{ "calledCustomer": true }
```

Missing = `true`. `false` clears the flag and the `…By…` fields.

**Response 200**
```json
{
  "ok": true,
  "notificationId": "notif001",
  "collection": "customer_notifications",
  "documentPath": "customer_notifications/notif001",
  "calledCustomer": true,
  "calledCustomerByUid": "agentUid1",
  "calledCustomerByName": "Sarah Johnson",
  "calledCustomerByEmail": "sarah.johnson@callcenter.com"
}
```

Values are read back from Firestore after the write.

**Errors:** `400 Missing notification id.`, `404 Notification not found.`, `422 Notification is missing business information.`, `403` business not assigned, `500 Could not update the notification.`

### 10.3 `POST /api/call-center/customer-notifications/{notificationId}/notification-reviewed`

Same rules as 10.2 for the reviewed flag.

**Request (optional)**
```json
{ "notificationReviewed": true }
```

**Response 200**
```json
{
  "ok": true,
  "notificationId": "notif001",
  "collection": "customer_notifications",
  "documentPath": "customer_notifications/notif001",
  "notificationReviewed": true,
  "notificationReviewedByUid": "agentUid1",
  "notificationReviewedByName": "Sarah Johnson",
  "notificationReviewedByEmail": "sarah.johnson@callcenter.com"
}
```

---

## 11. Call logs (agent activities)

Collection `agent_activities`, same shape as BMS Black and Pink. `ownerId` / `ownerName` mirror `businessId` / `businessName` so Command Center can report across brands.

### 11.1 `POST /api/call-center/agent-activities` — log a call

**Request**
```json
{
  "businessId": "biz001",
  "callId": "call-123",
  "callerNumber": "+61400000000",
  "callerName": "Sarah Mendis",
  "agentNote": "Wants a blocked drain inspection this week",
  "didNumber": "0390000000",
  "queueId": "q1",
  "queueName": "Trade Queue",
  "recordingUrl": "https://example.com/call-123.wav",
  "recordingFileName": "call-123.wav"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `businessId` | yes | or `ownerId`, or `X-Tenant-Id` |
| `callId` | yes | |
| `callerNumber` | yes | |
| `callerName`, `agentNote`, `didNumber`, `branchId`, `branchName`, `queueId`, `queueName` | no | stored as `""` when missing |
| recording | no | First of `recordingUrl`, `recordingFileUrl`, `recording_file_url`, `recordingPath`, `recording_path`, `recordingFile`, `recording_file` that looks like a URL, `gs://` path or file name becomes `recordingUrl`. `recordingFileName` / `recording_file_name` set the file name. |

**Response 201**
```json
{
  "ok": true,
  "id": "act001",
  "activity": {
    "id": "act001",
    "callId": "call-123",
    "callerNumber": "+61400000000",
    "agentName": "Sarah Johnson",
    "agentUserId": "agentUid1",
    "agentEmail": "sarah.johnson@callcenter.com",
    "agentRole": "call_center",
    "recordedByKind": "agent",
    "businessId": "biz001",
    "businessName": "Ace Plumbing Services",
    "ownerId": "biz001",
    "ownerName": "Ace Plumbing Services",
    "ownerTimezone": "Australia/Melbourne",
    "brand": "trade",
    "recordingUrl": "https://example.com/call-123.wav",
    "recordingFileName": "call-123.wav",
    "callerName": "Sarah Mendis",
    "agentNote": "Wants a blocked drain inspection this week",
    "didNumber": "0390000000",
    "branchId": "",
    "branchName": "",
    "queueId": "q1",
    "queueName": "Trade Queue",
    "createdAt": "2026-10-28T02:00:00.000Z",
    "updatedAt": "2026-10-28T02:00:00.000Z"
  }
}
```

For the AI receptionist, `agentRole` is `ai_receptionist` and `recordedByKind` is `ai`.

**Errors:** `400 Invalid JSON body.`, `400 Missing callId.`, `400 Missing callerNumber.`, `401`, `403`, `500 Could not save the call log.`

### 11.2 `GET /api/call-center/agent-activities` — list call logs

| Query | Required | Notes |
|-------|----------|-------|
| tenant | yes | `businessId` / `X-Tenant-Id`; `ownerId` also accepted |
| `agentUserId` | no | |
| `agentEmail` | no | case-insensitive |
| `callId` | no | |
| `limit` | no | default `25`, range 1–100 |

**Response 200**
```json
{ "ok": true, "activities": [ { "...activity object (11.1)" } ], "total": 1 }
```

**Errors:** `401`, `403`, `500 Could not fetch call logs.`

---

# Part C — Chat

All chat routes below are **aliases** of Trade's existing chat handlers in `app/api/chat/…`. Both paths work and behave the same. Chat timestamps are epoch milliseconds.

## 12. Direct chat (agent ↔ business owner)

Firestore `cc_direct_chats/{chatId}` with a `messages` subcollection. 1:1 ids look like `cc_<uidA>_<uidB>`. A queue request (owner did not pick an agent) has `queueStatus: "pending"` until an agent claims it.

### Room object
```json
{
  "chatId": "cc_agentUid1_ownerUid1",
  "workshopOwnerUid": "ownerUid1",
  "tenantUserUid": "ownerUid1",
  "tenantRole": "owner",
  "tenantName": "James Ace",
  "agentUid": "agentUid1",
  "agentName": "Sarah Johnson",
  "participantIds": ["agentUid1", "ownerUid1"],
  "queueStatus": "active",
  "sessionStatus": "open",
  "lastMessageText": "Hi James",
  "lastMessageAt": 1761990000000,
  "lastSenderId": "agentUid1",
  "unreadForTenant": true,
  "unreadForAgent": false,
  "chatsReviewed": false,
  "chatsReviewedAt": null,
  "chatsReviewedByUid": null,
  "closedAt": null,
  "closedByUid": null,
  "createdAt": 1761980000000,
  "updatedAt": 1761990000000
}
```

### Message object
```json
{
  "messageId": "msg001",
  "senderId": "agentUid1",
  "senderRole": "call_center",
  "messageKind": "user",
  "text": "Hi James",
  "createdAt": 1761990000000,
  "seenByRecipient": false,
  "readAt": null
}
```

`messageKind` is `system` for lines like "Chat ended".

### 12.1 Agent side

| Method | Path (alias of `/api/chat/cc-direct/agent/…`) | Request | Response 200 |
|--------|------|---------|----------|
| GET | `/api/call-center/chats?limit=50` | — | `{ "ok": true, "assigned": [room], "queue": [room] }` |
| GET | `/api/call-center/chats/workshop-owners` | — | `{ "ok": true, "owners": [ { "uid", "fullName", "email", "businessId" } ] }` |
| POST | `/api/call-center/chats/start-with-owner` | `{ "workshopOwnerUid": "ownerUid1", "text": "Hello" }` (`text` optional) | **201** `{ "ok": true, "room": room }` |
| GET | `/api/call-center/chats/{chatId}` | — | `{ "ok": true, "room": room }` |
| GET | `/api/call-center/chats/{chatId}/messages?limit=40&before=<messageId>` | — | `{ "ok": true, "messages": [message] }` |
| POST | `/api/call-center/chats/{chatId}/messages` | `{ "text": "How can I help?" }` | `{ "ok": true, "messageId": "msg001" }` |
| POST | `/api/call-center/chats/{chatId}/claim` | — | `{ "ok": true, "room": room }` |
| POST | `/api/call-center/chats/{chatId}/close` | — | `{ "ok": true }` |
| POST | `/api/call-center/chats/{chatId}/read` | — | `{ "ok": true }` |
| PATCH | `/api/call-center/chats/{chatId}/reviewed` | `{ "reviewed": true }` | `{ "ok": true }` |

Notes:
- `assigned` = open rooms of this agent; `queue` = open pending queue requests.
- An agent message on a closed session reopens it.
- Errors: `400 workshopOwnerUid is required.`, `400 Invalid request body.`, `400` claim on a non-pending room, `403 Access denied.`, `404 Chat not found.`

### 12.2 Owner side (business owner / admin / staff token)

| Method | Path (alias of `/api/chat/cc-direct/…`) | Request | Response |
|--------|------|---------|----------|
| GET | `/api/chats/cc/agents` | — | `{ "ok": true, "agents": [ { "id", "fullName", "email", "isOnline" } ] }` |
| GET | `/api/chats/cc/rooms?limit=50` | — | `{ "ok": true, "rooms": [room] }` |
| POST | `/api/chats/cc/rooms` | queue: `{ "queue": true }` — direct: `{ "agentUid": "agentUid1" }` | **201** `{ "ok": true, "room": room }` |
| GET | `/api/chats/cc/rooms/{chatId}/messages?limit=40&before=` | — | `{ "ok": true, "messages": [message] }` |
| POST | `/api/chats/cc/rooms/{chatId}/messages` | `{ "text": "Hello" }` | `{ "ok": true, "messageId": "msg002" }` — `409` if the session is closed |
| POST | `/api/chats/cc/rooms/{chatId}/read` | — | `{ "ok": true }` |
| POST | `/api/chats/cc/rooms/{chatId}/close` | — | `{ "ok": true }` |

## 12.3 Support chat (agent inbox)

Firestore `conversations/{id}` with `messages`. Statuses: `waiting` → `connected` (claimed) → `closed`.

### Conversation object
```json
{
  "conversationId": "conv001",
  "userId": "ownerUid1",
  "userName": "James Ace",
  "userEmail": "james@aceplumbing.com.au",
  "userPhone": "+61412345678",
  "role": "owner",
  "ownerUid": "ownerUid1",
  "status": "connected",
  "agentId": "agentUid1",
  "agentName": "Sarah Johnson",
  "agentEmail": "sarah.johnson@callcenter.com",
  "lastMessage": "Thanks!",
  "lastMessageAt": 1761990000000,
  "lastSender": "customer",
  "unreadForAgent": 1,
  "unreadForCustomer": 0,
  "createdAt": 1761980000000,
  "updatedAt": 1761990000000,
  "claimedAt": 1761981000000,
  "closedAt": null,
  "closedBy": null
}
```

### Support message object
```json
{
  "messageId": "smsg001",
  "sender": "agent",
  "senderId": "agentUid1",
  "senderName": "Sarah Johnson",
  "message": "Hi, how can I help?",
  "timestamp": 1761990000000,
  "readByAgent": true,
  "readByCustomer": false
}
```

`sender` is `customer`, `agent` or `system`.

| Method | Path (alias of `/api/chat/conversations/agent/…`) | Request | Response 200 |
|--------|------|---------|----------|
| GET | `/api/support-chat/agent/conversations?queueLimit=30&mineLimit=30` | — | `{ "ok": true, "queue": [conversation], "mine": [conversation] }` |
| POST | `/api/support-chat/agent/conversations/{id}/claim` | — | `{ "ok": true, "conversation": conversation }` |
| GET | `/api/support-chat/agent/conversations/{id}/messages?limit=40&before=` | — | `{ "ok": true, "messages": [support message] }` |
| POST | `/api/support-chat/agent/conversations/{id}/messages` | `{ "message": "Hi, how can I help?" }` | `{ "ok": true, "messageId": "smsg001" }` |
| POST | `/api/support-chat/agent/conversations/{id}/read` | — | `{ "ok": true }` |
| POST | `/api/support-chat/agent/conversations/{id}/close` | `{ "farewellMessage": "Thanks for contacting us!" }` (optional) | `{ "ok": true }` |
| POST | `/api/support-chat/agent/conversations/{id}/transfer` | `{ "targetAgentUid": "agentUid2" }` | `{ "ok": true }` |
| POST | `/api/support-chat/agent/presence` | `{ "online": true }` | `{ "ok": true }` |
| POST | `/api/support-chat/agent/fcm-token` | `{ "token": "<fcm device token>", "platform": "android" }` | `{ "ok": true }` |

Errors: `400 Conversation is not available to claim.`, `400 targetAgentUid is required.`, `400 FCM token is required.`, `400 Invalid request body.`, `403 Call-center or super admin access required.`

---

# Part D — Older `/api/callcenter/*` routes

These existed before the `/api/call-center/*` set and are kept for current clients. They take `?businessId=` (no `X-Tenant-Id`) and **do not check the agent's business assignment** — prefer the Part B routes.

| Method | Path | Request | Response 200 |
|--------|------|---------|----------|
| POST | `/api/callcenter/auth/login` | see section 4 | see section 4 |
| GET | `/api/callcenter/agents` | super admin token | `{ "ok": true, "agents": [ … ] }` |
| POST | `/api/callcenter/agents` | super admin token; `{ "fullName", "email", "password", "phone"?, "extension"?, "agentType"?, "notes"? }` | **201** `{ "ok": true, "agentId": "<uid>" }` |
| GET | `/api/callcenter/tenants?status=&search=&limit=` | — | `{ "ok": true, "total": 2, "tenants": [ … ] }` |
| GET | `/api/callcenter/staff?businessId=` | — | `{ "ok": true, "businessId", "total", "staff": [ … ] }` |
| GET | `/api/callcenter/services?businessId=` | — | `{ "ok": true, "businessId", "total", "services": [ catalog items ] }` |
| GET | `/api/callcenter/business-services?businessId=&activeOnly=true` | — | `{ "ok": true, "businessId", "total", "services": [ service object (8.1) ] }` |
| GET | `/api/callcenter/items?businessId=` | — | `{ "ok": true, "businessId", "total", "items": [ … ] }` |
| GET | `/api/callcenter/quotations?businessId=&status=` | — | `{ "ok": true, "businessId", "total", "quotations": [ … ] }` |

Full field lists for these are in the header comments of each `app/api/callcenter/*/route.ts`.

---

# Part E — Command Center proxy

Command Center (`command-center-backend`) exposes these routes at `/api/bms-blue/*`. The frontend sends its **Supabase** access token; Command Center swaps it for the stored Firebase Trade token and forwards `X-Tenant-Id`. Responses are passed through unchanged. Base URL env: `BLUE_API_BASE_URL`.

| Command Center | Trade upstream | Tenant |
|----------------|----------------|--------|
| `GET /api/bms-blue/workshops?summary=` | `GET /api/call-center/workshops` | — |
| `GET /api/bms-blue/staff?status=` | `GET /api/call-center/staff` | required |
| `GET /api/bms-blue/services?activeOnly=` | `GET /api/call-center/services` | required |
| `GET /api/bms-blue/services/:id` | `GET /api/call-center/services/:id` | required |
| `GET /api/bms-blue/services/:serviceId/staff?date=` | `GET /api/call-center/services/:serviceId/staff` | required |
| `GET /api/bms-blue/getallbooking?status=&date=&phone=&createdSource=&limit=&all=` | `GET /api/call-center/bookings` | optional |
| `GET /api/bms-blue/bookings/by-phone?phone=` | `GET /api/call-center/bookings?phone=&limit=50` | optional |
| `GET /api/bms-blue/bookings/availability?from=&to=` | `GET /api/call-center/bookings/availability` | required |
| `POST /api/bms-blue/bookings` | `POST /api/call-center/bookings` | required |
| `GET /api/bms-blue/bookings/:bookingId` | `GET /api/call-center/bookings/:id` | required |
| `PATCH` / `PUT /api/bms-blue/bookings/:bookingId` | `PATCH /api/call-center/bookings/:id` | required |
| `POST /api/bms-blue/bookings/:bookingId/confirm` · `/cancel` · `/complete` | same path on Trade | required |
| `PATCH /api/bms-blue/bookings/:bookingId/reschedule` | `PATCH /api/call-center/bookings/:id/reschedule` | required |
| `GET /api/bms-blue/customer-notifications?all=&unreadOnly=&limit=&sinceDays=` | `GET /api/call-center/customer-notifications` | required unless `all=1` |
| `POST /api/bms-blue/customer-notifications/:id/called-customer` · `/notification-reviewed` | same path on Trade | — |
| `POST /api/bms-blue/agent-activities` | `POST /api/call-center/agent-activities` | body or header |
| `GET /api/bms-blue/agent-activities?businessId=&…` | `GET /api/call-center/agent-activities` | query or header |
| `GET /api/bms-blue/chats?limit=` | `GET /api/call-center/chats` | — |
| `GET /api/bms-blue/chats/workshop-owners` | `GET /api/call-center/chats/workshop-owners` | — |
| `POST /api/bms-blue/chats/start-with-owner` | `POST /api/call-center/chats/start-with-owner` | — |
| `GET /api/bms-blue/chats/:chatId/messages` | `GET /api/call-center/chats/:chatId/messages` | — |
| `POST /api/bms-blue/chats/:chatId/messages` · `/claim` · `/close` · `/read` | same path on Trade | — |
| `PATCH /api/bms-blue/chats/:chatId/reviewed` | `PATCH /api/call-center/chats/:chatId/reviewed` | — |
| `GET /api/bms-blue/agent/conversations` (+ `/:id/claim`, `/messages`, `/read`, `/close`) | `/api/chat/conversations/agent/*` | — |

Command Center adds two errors of its own:

```json
{ "error": "Missing X-Tenant-Id header (businessId for BMS Trade call-center scope)." }
{ "error": "No stored Firebase Blue idToken for this user. Sign in again with POST /api/auth/login …" }
```

---

## 13. Differences from BMS Pink

| Topic | Pink | Trade |
|-------|------|-------|
| Tenant | salon owner uid (`ownerUid`) | `businessId` |
| Booking | appointment in `bookings` with services and stylists | inspection request in `requests` (one service, a visit window, one assignee) |
| Statuses | `Pending`, `AwaitingStaffApproval`, `Confirmed`, `Completed`, `Canceled`, … | `pending`, `owner_proposed`, `scheduled`, `awaiting_decision`, `cancelled`, `completed` |
| Booking code | `BK-YYYY-MMDDHH-NNNN` | `INS-REQ XXXXXXXX` |
| Availability | time slots for one day (`date`, `interval`) | unavailable morning / afternoon sessions over a range (`from`, `to`) |
| Confirm | assigns stylists per service | sets date + time window, optional `staffId` |
| Complete | allowed from confirmed | blocked until a quotation is saved |
| Branches | `/branches`, `/branches/{id}` | none (Trade has no branches) |
| Agent with no assignments | sees every salon | sees no business |
| Supabase `register-agent` / `firebase-token` | on Pink | not on Trade — Command Center provisions the Trade Firebase login at agent registration |
| Error shape | `{ "error" }` | `{ "ok": false, "error" }` |
