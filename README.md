# BMS Pro Trade — Admin Panel

A **Next.js 16 (App Router)** admin portal for trade businesses. It covers super-admin tenant management, business-owner dashboards (inspection visits, team, services, customers), a public customer booking engine, custom admin password reset (6-digit code), and transactional email via ZeptoMail.

### Feature quick reference

| Feature | UI | API / server | Docs section |
|---|---|---|---|
| Owner **Add Inspection** (4-step modal) | `components/add-inspection-modal.tsx` | `POST /api/inspection-requests` | [§8](#get--post-apiinspection-requests), [§11](#12-dashboard-pages) |
| Auto customer + default password `00001111` | Step 4 contact in modal | `ensureCustomerAccount()` in `lib/customer/server.ts` | [§5 customers](#customersuid), [§8 POST](#get--post-apiinspection-requests) |
| Public booking / inspection request | `components/booking-engine.tsx` | `POST /api/booking/inspection-request` | [§8 booking](#post-apibookinginspection-request) |
| Custom admin password reset | `components/forgot-password-modal.tsx` | `POST /api/auth/send-reset-code`, `reset-password` | [§7](#7-how-password-reset-works) |
| Email HTML templates | — | `lib/email/templates.ts` + `account-emails.ts` | [§6 — Where templates live](#where-email-templates-live) |
| Staff **Can get quotation** | `components/team-staff-form.tsx` | `users.canget_qutaion` via `/api/team/staff` | [§5 users](#usersuid) |
| Brand logo / favicon | `sidebar.tsx`, `app/login/page.tsx` | `public/bms_pro_blue.jpeg`, `app/icon.jpg` | [§3](#3-folder-structure) |

---

## Table of Contents

1. [Tech Stack & Packages](#1-tech-stack--packages)
2. [Environment Variables](#2-environment-variables)
3. [Folder Structure](#3-folder-structure)
4. [How Authentication Works](#4-how-authentication-works)
5. [How the Database Works (Firestore)](#5-how-the-database-works-firestore)
6. [How Email Works (ZeptoMail)](#6-how-email-works-zeptomail) — includes [where email templates live](#where-email-templates-live)
7. [How Password Reset Works](#7-how-password-reset-works)
8. [API Routes & Backend Functions](#8-api-routes--backend-functions)
9. [Route Flow Diagrams](#9-route-flow-diagrams)
10. [`lib/` — Shared Logic](#10-lib--shared-logic)
11. [`components/` — UI Components](#11-components--ui-components)
12. [Dashboard Pages](#12-dashboard-pages)
13. [Running the Project](#13-running-the-project)
14. [Scripts](#14-scripts)
15. [Architecture Overview](#architecture-overview)

---

## 1. Tech Stack & Packages

| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.6 | App Router framework |
| `react` / `react-dom` | 19.2.4 | UI rendering |
| `firebase` | ^12 | Client-side Auth + Firestore (browser) |
| `firebase-admin` | ^13 | Server-side Auth + Firestore + Storage (API routes) |
| `zeptomail` | ^8 | Transactional email (welcome, reset codes, notifications) |
| `framer-motion` | ^12 | Animations |
| `lucide-react` | ^1 | Icons |
| `tailwindcss` | ^4 | Styling (no config file — configured via `globals.css`) |
| `@tailwindcss/postcss` | ^4 | Tailwind v4 PostCSS plugin |
| `typescript` | ^5 | Type safety |
| `tsx` | ^4 | Run scripts (e.g. seed-super-admin) directly with TypeScript |

> **Tailwind v4 note:** There is no `tailwind.config.js`. All theme tokens (Material Design 3 colors, spacing, fonts) are defined inside `app/globals.css` under `@theme inline`.

---

## 2. Environment Variables

Create a `.env.local` file in the project root. **Never commit this file.**

```env
# ── Firebase Web SDK (public — safe to expose to the browser) ──────────────
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=

# ── Firebase Admin SDK (server only — never expose to browser) ────────────
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=          # Paste the full PEM key; \n are auto-replaced

# ── App URL ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_BOOKING_BASE_URL=        # e.g. https://yourdomain.com

# ── ZeptoMail (server only) ───────────────────────────────────────────────
ZEPTOMAIL_URL=                       # e.g. https://api.zeptomail.com.au/v1.1/email
ZEPTOMAIL_SYSTEM_TOKEN=              # noreply@ sender token
ZEPTOMAIL_SYSTEM_FROM_ADDRESS=       # noreply@yourdomain.com
ZEPTOMAIL_SYSTEM_FROM_NAME=          # BMS Pro Trade

ZEPTOMAIL_REQUEST_TOKEN=             # request@ sender token
ZEPTOMAIL_REQUEST_FROM_ADDRESS=      # request@yourdomain.com
ZEPTOMAIL_REQUEST_FROM_NAME=         # BMS Pro Trade
```

---

## 3. Folder Structure

```
bmspro-trade-adminpanel/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout: fonts, Providers, Material Symbols CSS
│   ├── page.tsx                  # Redirects / → /dashboard
│   ├── globals.css               # Tailwind v4 + MD3 design tokens
│   ├── icon.jpg                  # Browser favicon (auto-detected by Next.js)
│   │
│   ├── login/page.tsx            # Admin sign-in page
│   ├── onboard/page.tsx          # Self-service business registration
│   ├── account/                  # Legacy customer account route
│   │
│   ├── dashboard/                # All authenticated admin pages
│   │   ├── layout.tsx            # AuthGuard + DashboardDataProviders
│   │   ├── page.tsx              # Today dashboard
│   │   ├── inspection-visits/    # Inspection request board
│   │   ├── bookings/             # Placeholder (links to inspection visits)
│   │   ├── customers/            # Customer board
│   │   ├── team/                 # Staff management
│   │   ├── services/             # Services (owner) / Templates (super admin)
│   │   ├── tenants/              # Super-admin tenant management
│   │   └── settings/             # Business settings, logo upload
│   │
│   ├── booknow/[slug]/           # Public customer booking engine
│   │   ├── page.tsx              # Service selection + request form
│   │   └── account/              # Customer account tabs (bookings, notifications...)
│   │
│   └── api/                      # All API route handlers
│       ├── auth/
│       │   ├── send-reset-code/route.ts   # Send 6-digit password reset code
│       │   └── reset-password/route.ts    # Verify code + update password
│       ├── admin/
│       │   ├── tenants/
│       │   │   ├── list/route.ts
│       │   │   └── create/route.ts
│       │   └── service-templates/
│       │       ├── route.ts
│       │       └── [id]/route.ts
│       ├── service-templates/route.ts
│       ├── services/
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── business/profile/route.ts
│       ├── uploads/
│       │   ├── business-logo/route.ts
│       │   └── service-image/route.ts
│       ├── team/staff/route.ts
│       ├── inspection-requests/
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── booking/inspection-request/route.ts
│       ├── notifications/
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── customer/
│       │   ├── profile/route.ts
│       │   ├── bookings/route.ts
│       │   ├── bookings/[id]/route.ts
│       │   ├── notifications/route.ts
│       │   └── notifications/[id]/route.ts
│       └── onboarding/submit/route.ts
│
├── components/                   # All React components (see §11)
│   ├── add-inspection-modal.tsx  # Owner 4-step Add Inspection wizard
│   ├── inspection-visits-board.tsx
│   ├── booking-engine.tsx
│   └── ...
├── lib/                          # All shared server + client logic (see §10)
│   └── email/                    # Transactional email (see §6 — Email templates)
│       ├── templates.ts          # Shared HTML layout: renderEmail()
│       ├── account-emails.ts     # Welcome + password reset senders
│       └── zeptomail.ts          # ZeptoMail API transport
├── public/
│   └── bms_pro_blue.jpeg         # Brand logo (served at /bms_pro_blue.jpeg)
│                                 # Used in: sidebar header, top header, login page (desktop + mobile)
├── app/
│   └── icon.jpg                  # Favicon — Next.js App Router auto-detects this as the browser tab icon
│                                 # (favicon.ico was deleted; icon.jpg takes precedence)
├── scripts/
│   └── seed-super-admin.ts       # One-time script: create the first super admin
├── firestore.rules               # Firestore security rules
├── firestore.indexes.json        # Composite indexes
├── firebase.json                 # Firebase deploy config
└── .env.local                    # Local secrets (never commit)
```

### Brand logo usage

`public/bms_pro_blue.jpeg` is served as a static asset at `/bms_pro_blue.jpeg` and referenced in:

| Location | Component | Where |
|---|---|---|
| Sidebar header logo | `components/sidebar.tsx` | Top-left icon in the nav (all roles) |
| Top header logo | `components/dashboard-shell.tsx` | Left side of the top bar (all roles) |
| Login page — desktop | `app/login/page.tsx` | Brand panel left side |
| Login page — mobile | `app/login/page.tsx` | Mobile header above the form |
| Favicon | `app/icon.jpg` | Browser tab icon (copy of the same image) |

> **Note:** The `brandLogo` variable in `sidebar.tsx` and `dashboard-shell.tsx` still reads `business.logoUrl` from Firestore for business owners — the static `/bms_pro_blue.jpeg` is used only in the sidebar/header logo spots that were previously showing the `architecture` Material icon for super admins.

---

## 4. How Authentication Works

### Admin Authentication

**File:** `lib/auth/auth-context.tsx`

The app uses **Firebase Client SDK** on the browser for sign-in and **Firebase Admin SDK** on the server for privileged operations.

#### Sign-in flow

```
User submits email + password
  → signInWithEmailAndPassword(auth, email, password)    [firebase/auth]
  → getIdTokenResult()                                   [reads JWT claims]
  → Checks claims: businessId + role=owner → "business_owner"
                   superAdmin=true         → "super_admin"
  → Falls back to Firestore: super_admins/{uid} exists?  → "super_admin"
  → If no role found → signOut (unauthorized)
  → Stores role in sessionStorage cache
  → router.replace("/dashboard")
```

#### Roles

| Role | Access |
|---|---|
| `super_admin` | Tenants, global service templates, all data |
| `business_owner` | Their own services, team, inspection visits, customers |

#### How the session is kept

- Role + businessId are cached in `sessionStorage` under key `bms.auth.session`
- TTL: cleared on sign-out; refreshed on next page load from Firebase
- `AuthGuard` component redirects unauthenticated users from `/dashboard` to `/login`

### Customer Authentication

**File:** `lib/customer-auth/customer-auth-context.tsx`

Customers (who submit inspection requests via `/booknow/[slug]`) have a separate Firebase project and auth flow. They sign in via a modal on the booking pages.

---

## 5. How the Database Works (Firestore)

The project uses **Cloud Firestore** (Firebase) as its primary database. All server-side reads/writes go through `lib/firebase/admin.ts` (Firebase Admin SDK). Real-time client listeners use `lib/firebase/client.ts` (Firebase Client SDK).

### All Collections — Quick Reference

| Collection path | Document ID | Primary purpose |
|---|---|---|
| `businesses/{id}` | Auto UUID | Tenant/business workspace |
| `users/{uid}` | Firebase Auth UID | Owner + staff accounts |
| `super_admins/{uid}` | Firebase Auth UID | Super admin gate |
| `customers/{uid}` | Firebase Auth UID | Customer profiles (book-now side) |
| `inspection_requests/{id}` | Auto UUID | Inspection visit requests |
| `business_notifications/{id}` | Auto UUID | Owner/admin notifications |
| `customer_notifications/{id}` | Auto UUID | Customer notifications |
| `service_templates/{id}` | Auto UUID | Super-admin global service catalog |
| `services/{id}` | Auto UUID | Business-owned services |
| `passwordResetCodes/{email}` | Lowercase email | 6-digit OTP reset codes |
| `booking_intake_attempts/{id}` | Auto UUID | Rate-limit audit log (rules only) |
| `service_template_tasks/{id}` | Auto UUID | *(Legacy)* Standalone template tasks |
| `service_tasks/{id}` | Auto UUID | *(Legacy)* Standalone service tasks |

---

### `businesses/{businessId}`

Written by `lib/onboarding/server.ts`. One document per tenant business.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID (mirrors Firestore ID) |
| `businessName` | `string` | Business display name |
| `businessType` | `string` | Trade type (`"Plumbing"`, `"Electrical"`, `"HVAC"`, etc.) |
| `abn` | `string \| null` | Australian Business Number |
| `businessStructure` | `string` | `"Pty Ltd"`, `"Sole Trader"`, `"Partnership"`, `"Trust"` |
| `registeredForGst` | `boolean` | GST registration flag |
| `businessAddress` | `string \| null` | Street address |
| `state` | `string` | AU state code (`"NSW"`, `"VIC"`, etc.) |
| `postcode` | `string` | 4-digit postcode |
| `timezone` | `string` | IANA timezone (e.g. `"Australia/Sydney"`) |
| `businessPhone` | `string` | Business phone number |
| `businessEmail` | `string` | Owner account email |
| `mainSuburb` | `string` | Computed as `"{state}, {postcode}"` |
| `serviceAreas` | `string[]` | Suburbs/areas served |
| `logoUrl` | `string \| null` | Public HTTPS URL of the business logo |
| `bookingSlug` | `string` | Unique slug → `/booknow/{slug}` |
| `bookingPath` | `string` | Computed as `"/booknow/{bookingSlug}"` |
| `ownerUid` | `string \| null` | **→ `users/{uid}`** (owner Firebase Auth UID) |
| `owner.fullName` | `string \| null` | Owner full name (embedded) |
| `owner.email` | `string` | Owner email (embedded) |
| `plan.id` | `string` | Plan ID (`"booking_management"`, `"trade_pro"`, etc.) |
| `plan.name` | `string` | Plan display name |
| `plan.price` | `number` | Plan price |
| `plan.period` | `string` | Billing period (e.g. `"7-day"`) |
| `plan.trialDays` | `number \| null` | Trial length in days |
| `status` | `string` | `"pending_review"` / `"active"` / `"suspended"` |
| `source` | `string` | `"self_signup"` or `"super_admin_create"` |
| `isActive` | `boolean` | `true` when `status === "active"` |
| `onboardingProgress` | `number` | Completion percentage (100 on create) |
| `onboardingStep` | `string` | `"complete"` after onboarding |
| `createdByUid` | `string \| null` | **→ `super_admins/{uid}`** |
| `createdByEmail` | `string \| null` | Email of creating super admin |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

---

### `users/{uid}`

Written by `lib/onboarding/server.ts` (owners) and `app/api/team/staff/route.ts` (staff). Document ID = Firebase Auth UID.

**Owner fields:**

| Field | Type | Description |
|---|---|---|
| `uid` | `string` | Firebase Auth UID |
| `email` | `string` | Account email |
| `fullName` | `string \| null` | Owner full name |
| `businessId` | `string` | **→ `businesses/{businessId}`** |
| `role` | `string` | `"owner"` |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

**Staff fields (additional):**

| Field | Type | Description |
|---|---|---|
| `phone` | `string` | Mobile number (digits only) |
| `role` | `string` | `"staff"` |
| `staffType` | `string` | Role label (e.g. `"Plumber"`, `"Electrician"`) |
| `availability` | `array` | Weekly availability schedule |
| `availability[].day` | `string` | `"monday"` … `"sunday"` |
| `availability[].isOff` | `boolean` | Day off flag |
| `availability[].serviceAreas` | `string[]` | Up to 1 service area per working day |
| `status` | `string` | `"active"` or `"suspended"` |
| `isActive` | `boolean` | Mirrors `status === "active"` |
| `createdByUid` | `string` | **→ `users/{uid}`** (creating owner) |
| `createdByEmail` | `string \| null` | Email of creating owner |
| `canget_qutaion` | `boolean` | Whether staff can receive/handle quotation requests (default `false`) |

---

### `super_admins/{uid}`

Document ID = Firebase Auth UID. Written once by the seed script.

| Field | Type | Description |
|---|---|---|
| `isActive` | `boolean` | `false` = access denied even if doc exists |

---

### `customers/{uid}`

Written by `lib/customer/server.ts`. Document ID = Firebase Auth UID (customer auth project).

| Field | Type | Description |
|---|---|---|
| `uid` | `string` | Firebase Auth UID |
| `email` | `string` | Normalized lowercase email |
| `fullName` | `string` | Customer full name |
| `phone` | `string` | Mobile (digits only) |
| `registeredBusinessId` | `string` | **→ `businesses/{businessId}`** (set on first signup) |
| `registeredBookingSlug` | `string` | Denormalized booking slug at registration |
| `registeredBusinessName` | `string` | Denormalized business name at registration |
| `welcomeEmailSent` | `boolean` | `true` after welcome email sent |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

**How customers are created:**

| Path | Who creates | Password | Welcome email |
|---|---|---|---|
| Public `/booknow/[slug]` | Customer signs up in `CustomerAuthModal` | Customer chooses | `sendCustomerWelcomeEmail` (no password) on first profile save |
| Owner **Add Inspection** modal | `ensureCustomerAccount()` in `POST /api/inspection-requests` | Default **`00001111`** if new Firebase Auth user | Welcome email with credentials when email is **new to `customers` collection** |
| Owner updates profile via API | Existing customer only | — | Welcome email once if `welcomeEmailSent` was false |

**Default customer password (owner-created only):** `DEFAULT_CUSTOMER_PASSWORD = "00001111"` in `lib/customer/server.ts` (same value as default staff password).

---

### `inspection_requests/{requestId}`

Written by `lib/inspection/server.ts`. The central workflow collection.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID |
| `businessId` | `string` | **→ `businesses/{businessId}`** |
| `status` | `string` | `"pending"` / `"owner_proposed"` / `"scheduled"` / `"cancelled"` / `"completed"` |
| `requestType` | `string` | `"existing_service"` or `"custom_quote"` |
| `serviceId` | `string \| null` | **→ `services/{serviceId}`** |
| `serviceName` | `string \| null` | Denormalized service name |
| `serviceBusinessType` | `string \| null` | Denormalized trade type |
| `customRequest.title` | `string` | Title for custom work |
| `customRequest.description` | `string` | Description for custom work |
| `customer.fullName` | `string` | Customer name (embedded) |
| `customer.email` | `string` | Customer email (embedded) |
| `customer.phone` | `string` | Customer phone (embedded) |
| `customerId` | `string \| null` | **→ `customers/{uid}`** |
| `address.street` | `string` | Street address |
| `address.suburb` | `string` | Suburb |
| `address.state` | `string` | State |
| `address.postcode` | `string` | Postcode |
| `preferredSlots[]` | `array` | Customer preferred slots (max 3) |
| `preferredSlots[].date` | `string` | `YYYY-MM-DD` |
| `preferredSlots[].timeRange` | `string` | `"morning"` or `"afternoon"` |
| `ownerProposedSlots[]` | `array` | Owner-proposed alternative slots (same shape) |
| `scheduledSlot` | `map \| null` | Confirmed slot (same shape as above) |
| `scheduledStartTime` | `string \| null` | Exact start time `"HH:MM"` (24h) |
| `scheduledEndTime` | `string \| null` | Exact end time `"HH:MM"` (24h) |
| `assignedTo.type` | `string` | `"staff"` or `"owner"` |
| `assignedTo.uid` | `string` | **→ `users/{uid}`** |
| `assignedTo.name` | `string` | Assignee display name |
| `assignedTo.email` | `string \| null` | Assignee email |
| `ownerNote` | `string \| null` | Note from business owner |
| `customerNotes` | `string \| null` | Extra context from customer |
| `budgetAud` | `number \| null` | Optional budget in AUD |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

---

### `business_notifications/{notificationId}`

Written by `lib/notifications/server.ts` as a side-effect of inspection request actions.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID |
| `businessId` | `string` | **→ `businesses/{businessId}`** |
| `requestId` | `string` | **→ `inspection_requests/{requestId}`** |
| `customerId` | `string \| null` | **→ `customers/{uid}`** |
| `customerEmail` | `string \| null` | Customer email (denormalized) |
| `customerName` | `string \| null` | Customer name (denormalized) |
| `bookingSlug` | `string \| null` | Business booking slug (denormalized) |
| `businessName` | `string \| null` | Business name (denormalized) |
| `status` | `string` | Inspection status at time of notification |
| `type` | `string` | `"request_created"` / `"request_scheduled"` / `"request_proposed"` / `"request_cancelled"` / `"request_completed"` / `"request_assigned"` |
| `title` | `string` | Notification title |
| `body` | `string` | Notification body |
| `read` | `boolean` | Read flag (default `false`) |
| `createdAt` | `Timestamp` | Server timestamp |

---

### `customer_notifications/{notificationId}`

Same schema as `business_notifications`. Queried by `customerId` and/or `customerEmail`.

| Field | Type | Description |
|---|---|---|
| `customerId` | `string \| null` | **→ `customers/{uid}`** |
| `requestId` | `string` | **→ `inspection_requests/{requestId}`** |
| `businessId` | `string \| null` | **→ `businesses/{businessId}`** |
| *(all other fields same as business_notifications)* | | |

---

### `service_templates/{templateId}`

Written by `lib/onboarding/services/server.ts`. Super-admin global catalog.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID |
| `name` | `string` | Template name |
| `businessType` | `string` | Trade type (e.g. `"Plumbing"`) |
| `isActive` | `boolean` | Available to business owners |
| `tasks[]` | `array` | Embedded checklist tasks |
| `tasks[].id` | `string` | Task UUID |
| `tasks[].title` | `string` | Task title |
| `tasks[].description` | `string` | Task description |
| `tasks[].sortOrder` | `number` | Display order (0-based) |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

---

### `services/{serviceId}`

Written by `lib/onboarding/services/server.ts`. Per-business services.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID |
| `businessId` | `string` | **→ `businesses/{businessId}`** |
| `templateId` | `string \| null` | **→ `service_templates/{templateId}`** (null = custom) |
| `name` | `string` | Service name |
| `businessType` | `string` | Trade/category type |
| `requiredSkill` | `string` | Skill needed to perform service |
| `defaultDurationMin` | `number` | Duration in minutes |
| `isActive` | `boolean` | Visible in booking engine |
| `imageUrl` | `string \| null` | Public HTTPS image URL |
| `tasks[]` | `array` | Embedded checklist (same shape as template tasks) |
| `tasks[].id` | `string` | Task UUID |
| `tasks[].title` | `string` | Task title |
| `tasks[].description` | `string` | Task description |
| `tasks[].sortOrder` | `number` | Display order |
| `createdAt` | `Timestamp` | Server timestamp |
| `updatedAt` | `Timestamp` | Server timestamp |

---

### `passwordResetCodes/{email}`

Written by `/api/auth/send-reset-code`. Document ID = lowercase email address.

| Field | Type | Description |
|---|---|---|
| `code` | `string` | 6-digit reset code (plain text) |
| `expiresAt` | `Timestamp` | Expiry (15 minutes from creation) |
| `createdAt` | `Timestamp` | Server timestamp |
| `attempts` | `number` | Failed verification count (max 5 before deletion) |
| `used` | `boolean` | `true` after successful password reset |

---

### Legacy Collections (read-only fallback)

| Collection | Key field | Links to |
|---|---|---|
| `service_template_tasks/{id}` | `templateId` | **→ `service_templates/{id}`** |
| `service_tasks/{id}` | `serviceId` | **→ `services/{id}`** |

These are read only when a template/service document has no embedded `tasks[]` array. New writes always use embedded tasks.

---

### How Collections Connect (Entity Relationships)

```
super_admins/{uid}
  └── creates ──────────────────────────────────────────────────────┐
                                                                     ▼
businesses/{businessId} ◄────────────────────────────── users/{uid}
  │  ├─ ownerUid ─────────────────────────────────────► users/{uid}  (owner)
  │  └─ createdByUid ─────────────────────────────────► super_admins/{uid}
  │
  ├──► users/{uid}                     (staff; businessId field)
  ├──► services/{serviceId}            (businessId field)
  ├──► inspection_requests/{id}        (businessId field)
  ├──► business_notifications/{id}     (businessId field)
  └──► customers/{uid}                 (registeredBusinessId field)

service_templates/{templateId}
  └──► services/{serviceId}            (templateId field)

services/{serviceId}
  └──► inspection_requests/{id}        (serviceId field)

customers/{uid}
  └──► inspection_requests/{id}        (customerId field)

inspection_requests/{id}
  ├── assignedTo.uid ─────────────────► users/{uid}   (staff/owner)
  ├──► business_notifications/{id}     (requestId field)
  └──► customer_notifications/{id}     (requestId field)

passwordResetCodes/{email}
  └── resolves via adminAuth.getUserByEmail() ─► Firebase Auth user
```

---

### How the Admin SDK is used (server)

**File:** `lib/firebase/admin.ts`

```ts
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";

// Verify a user
const user = await adminAuth.getUserByEmail(email);

// Read a document
const snap = await adminDb.collection("businesses").doc(businessId).get();
const data = snap.data();

// Write a document
await adminDb.collection("passwordResetCodes").doc(email).set({
  code, expiresAt, createdAt: FieldValue.serverTimestamp(), attempts: 0, used: false
});

// Update a field
await adminDb.collection("inspection_requests").doc(id).update({ status: "scheduled" });

// Update a Firebase Auth user's password
await adminAuth.updateUser(uid, { password: newPassword });
```

### How the Client SDK is used (browser)

**File:** `lib/firebase/client.ts`

```ts
import { auth, db } from "@/lib/firebase/client";
import { onSnapshot, doc, collection, query, where } from "firebase/firestore";

// Real-time listener on a single document
onSnapshot(doc(db, "businesses", businessId), (snap) => {
  const data = snap.data();
});

// Query a collection
const q = query(
  collection(db, "inspection_requests"),
  where("businessId", "==", businessId)
);
onSnapshot(q, (snapshot) => {
  const items = snapshot.docs.map(d => d.data());
});
```

### Firestore Security Rules

Defined in `firestore.rules`. Key rules:

| Collection | Client can read | Client can write |
|---|---|---|
| `super_admins/{uid}` | Own doc only | Never |
| `businesses/{id}` | Super admin or owning business | Never (server only) |
| `users/{uid}` | Own doc only | Never |
| `service_templates/{id}` | Super admin or active templates for owner's trade | Never |
| `services/{id}` | Super admin or owning business | Never |
| `inspection_requests/{id}` | Super admin, owning business, or owning customer | Never |
| `business_notifications/{id}` | Owning business | `read` field only; delete allowed |
| `customer_notifications/{id}` | Owning customer | `read` field only; delete allowed |

Deploy rules:
```bash
npm run firebase:deploy-rules
```

---

## 6. How Email Works (ZeptoMail)

The project uses **ZeptoMail** for all transactional emails. It never uses Firebase's built-in email (except for auth-related links disabled in favour of the custom code flow).

### Where email templates live

There are **no separate `.html` or React email files**. All HTML is built in TypeScript under `lib/email/`:

| File | Role | What to edit |
|---|---|---|
| **`lib/email/templates.ts`** | **Master layout** — single shared design for every email | Header gradient, logo band, body typography, detail tables, highlight callout, login-credentials card, CTA button, footer. Export: `renderEmail(content)`, `renderCustomerEmail()` (alias) |
| **`lib/email/account-emails.ts`** | **Account / auth copy** — fills `renderEmail()` per use case | Subject lines, eyebrow, title, body text, `details` rows, `loginCredentials` for staff/customer welcome |
| **`lib/email/zeptomail.ts`** | **Transport only** — no HTML | `sendEmail({ sender, to, subject, htmlBody })` → ZeptoMail API |
| **`lib/notifications/server.ts`** | **Inspection lifecycle copy** — customer notification emails | `EMAIL_PRESENTATION` (tone per type), `sendCustomerNotificationEmail()` builds `renderEmail()` from notification title/body |

**Layout vs copy:** Change **look and feel** in `templates.ts`. Change **wording or which fields appear** in `account-emails.ts` or `notifications/server.ts`.

### Which file sends which email

| Email | Template builder | Sender function | ZeptoMail sender | Triggered from |
|---|---|---|---|---|
| Business owner welcome | `account-emails.ts` | `sendOwnerWelcomeEmail` | `system` | `lib/onboarding/server.ts` (tenant create) |
| Customer welcome (book-now signup) | `account-emails.ts` | `sendCustomerWelcomeEmail` | `system` | `lib/customer/server.ts` (`updateCustomerProfile`) |
| Customer welcome (owner Add Inspection, password `00001111`) | `account-emails.ts` | `sendCustomerWelcomeEmail` + `temporaryPassword` | `system` | `lib/customer/server.ts` (`ensureCustomerAccount`) |
| Staff welcome + temp password | `account-emails.ts` | `sendStaffWelcomeEmail` | `system` | `app/api/team/staff/route.ts` (POST) |
| Admin password reset 6-digit code | `account-emails.ts` | `sendPasswordResetCodeEmail` | `system` | `app/api/auth/send-reset-code/route.ts` |
| Inspection request received (customer) | `notifications/server.ts` | `notifyCustomerOfNewRequest` → `sendCustomerNotificationEmail` | `request` | `lib/inspection/server.ts` (`createInspectionRequest`) |
| Visit confirmed / proposed / assigned / cancelled / completed (customer) | `notifications/server.ts` | `notifyCustomerOfStatusChange`, `notifyCustomerOfAssignment`, etc. | `request` | `lib/inspection/server.ts` (`applyOwnerAction`, etc.) |

> **Business owners** get inspection updates as **in-app** `business_notifications` only (no email in `notifications/server.ts`). **Customers** get Firestore notifications **and** a matching email when `customerEmail` is set.

### Architecture

```
Caller (API route or lib/server.ts)
  → build copy + call renderEmail({ ... })     [lib/email/templates.ts]
  → sendEmail({ htmlBody, sender, to, ... })   [lib/email/zeptomail.ts]
      → SendMailClient (zeptomail npm package)
          → ZeptoMail REST API → delivered to recipient
```

### Two Senders

| Sender key | From address | Used for |
|---|---|---|
| `"system"` | `noreply@bmspros.com.au` | Welcome emails, password reset codes, account emails |
| `"request"` | `request@bmspros.com.au` | Inspection request updates, booking notifications |

### Email functions

**File:** `lib/email/account-emails.ts`

| Function | Description |
|---|---|
| `sendOwnerWelcomeEmail(input)` | Sends welcome email when a business owner is onboarded |
| `sendCustomerWelcomeEmail(input)` | Sends welcome to a new customer. When `temporaryPassword` is set (owner-created account), includes a login-credentials card (email + password) |
| `sendStaffWelcomeEmail(input)` | Sends welcome + temp password to a new staff member |
| `sendPasswordResetCodeEmail(input)` | Sends the 6-digit password reset code |

### HTML template system (`lib/email/templates.ts`)

**Exports:** `renderEmail`, `renderCustomerEmail`, types `EmailTemplateContent`, `EmailDetailRow`, `EmailTone`.

**Internal helpers** (same file, not exported): `loginCredentialsBlock`, `detailRows`, `paragraphs`, `escapeHtml`, tone palette `TONES`.

All emails use `renderEmail(content)`, which returns one fully inlined HTML document (table-based, email-client safe). The template supports:

```ts
renderEmail({
  eyebrow: "Password reset",          // small label above title
  tone: "brand",                       // "brand" | "success" | "warning" | "danger" | "neutral"
  title: "Reset your password",
  body: "Use the 6-digit code below…",
  highlight: "482910",                 // large highlighted callout (e.g. the code)
  highlightLabel: "Your verification code",
  ctaUrl: "https://...",              // optional CTA button
  ctaLabel: "Go to dashboard",
  footnote: "If you didn't request…",
  businessName: "BMS Pro Trade",
  logoUrl: "https://...",             // optional business logo in header
  loginCredentials: {                 // optional styled login card
    email: "...", password: "..."
  }
})
```

### Sending an email (example)

```ts
import { sendEmail } from "@/lib/email/zeptomail";
import { renderEmail } from "@/lib/email/templates";

const html = renderEmail({ title: "Hello", body: "Welcome!", tone: "brand" });

await sendEmail({
  sender: "system",            // or "request"
  to: "user@example.com",
  toName: "John",
  subject: "Hello from BMS Pro Trade",
  htmlBody: html,
});
```

> `sendEmail` is **best-effort** — it never throws. If the token is missing or the API fails, it logs a warning and returns `false`.

---

## 7. How Password Reset Works

The password reset flow is custom-built (not Firebase's default email link). It uses a 6-digit OTP code sent via ZeptoMail and a multi-stage modal UI.

### UI — Modal stages

The modal (`components/forgot-password-modal.tsx`) is sized at `max-w-lg` with `p-8` padding and renders 5 stages in sequence:

| Stage | Name | What the user sees |
|---|---|---|
| 1 | `"form"` | Email input + **Send Code** button |
| 2 | `"sent"` | Green check + "Check your email" + **Close** / **Enter Code** buttons |
| 3 | `"code"` | Email (read-only) + 6 individual digit boxes + **Verify Code** + Back to Login |
| 4 | `"password"` | New Password + Confirm Password inputs + **Reset Password** button |
| 5 | `"done"` | Green check + "Password updated!" + **Back to Sign In** |

### Stage-by-stage flow

```
Stage 1 — Email form
  User enters email → clicks "Send Code"
  → POST /api/auth/send-reset-code { email }
      → Validate email format
      → adminAuth.getUserByEmail(email)
          └── not found → return { ok: true }   ← anti-enumeration (no error shown)
      → read passwordResetCodes/{email}
          └── createdAt < 60s ago → 429 rate limited
      → generate 6-digit code
      → write passwordResetCodes/{email} {
            code, expiresAt (+15min),
            createdAt, attempts: 0, used: false
          }
      → sendPasswordResetCodeEmail({ email, code }) → ZeptoMail API
  → Advance to stage 2

Stage 2 — Sent screen
  Shows email address + green check
  "Enter Code" button → advance to stage 3

Stage 3 — Enter code
  6 individual input boxes (auto-advance on type, paste support)
  → Client-side only: check all 6 boxes filled
  → "Verify Code" clicked → advance to stage 4
  ⚠ Code is NOT verified here to avoid marking it used prematurely.
  If the code turns out to be wrong in stage 4, user is returned here.

Stage 4 — New password
  User enters new password + confirm
  → Client-side: password ≥ 8 chars, passwords match
  → POST /api/auth/reset-password { email, code, newPassword }
      → read passwordResetCodes/{email}
          ├── doc missing     → 400 "Invalid or expired code"
          ├── used === true   → 400 "already been used"
          ├── expiresAt < now → delete doc → 400 "Code has expired"
          ├── attempts > 5   → delete doc → 400 "Too many incorrect attempts"
          └── code mismatch  → update { attempts++ } → 400 "Incorrect code. N attempt(s) remaining."
      → adminAuth.getUserByEmail(email)
      → adminAuth.updateUser(uid, { password: newPassword })
      → update passwordResetCodes/{email} { used: true }
  → Advance to stage 5

  ⚠ Error handling in stage 4:
      Code errors (incorrect/expired/used/too many attempts)
        → digits cleared → user returned to stage 3 with error shown there
      Password errors (too short, mismatch)
        → error shown on stage 4 (password screen)

Stage 5 — Done
  "Password updated!" + "Back to Sign In" → closes modal
```

### 6-digit code input features

- **Auto-advance:** typing a digit moves focus to the next box automatically
- **Backspace:** moves focus to the previous box
- **Paste:** paste a 6-digit code into the first box to fill all boxes at once
- **Disabled submit:** "Verify Code" button disabled until all 6 boxes are filled

### Security measures

| Measure | Detail |
|---|---|
| Anti-enumeration | API returns `{ ok: true }` even for unknown emails — no user disclosure |
| Rate limiting | One code per 60 seconds per email address |
| Expiry | Code valid for 15 minutes only |
| Attempt tracking | Wrong code increments `attempts`; doc deleted after 5 failures |
| Single use | Code marked `used: true` immediately after successful password update |
| Min password length | 8 characters enforced server-side |
| No pre-verification | Code is not verified at stage 3 — only once with the new password — prevents double-use bugs |
| Smart error routing | Code errors in stage 4 send the user back to stage 3; password errors stay on stage 4 |

### Files involved

| File | Role |
|---|---|
| `components/forgot-password-modal.tsx` | All 5 stages of the modal UI (`max-w-lg`, `p-8`) |
| `components/login-form.tsx` | "Forgot password?" button; modal rendered outside `<form>` tag to avoid nesting |
| `app/api/auth/send-reset-code/route.ts` | Generates + stores + emails the 6-digit code |
| `app/api/auth/reset-password/route.ts` | Verifies code + updates password via Firebase Admin SDK |
| `lib/email/account-emails.ts` | `sendPasswordResetCodeEmail()` |

### Notes for developers

- The modal is opened from `LoginForm` via `forgotOpen` state and rendered **outside** the login `<form>` tag — this prevents invalid nested `<form>` elements (the modal itself contains forms in stages 1, 3, and 4).
- All `<input type="email">` and `<input type="password">` fields include `suppressHydrationWarning` to prevent React hydration mismatches caused by browser password-manager extensions injecting attributes.
- The modal resets all state (email, digits, passwords, stage, errors) whenever it is opened.

---

## 8. API Routes & Backend Functions

All routes live in `app/api/`. Every handler is a Next.js Route Handler (`route.ts`). Shared server logic lives in `lib/`.

### Authentication Patterns

Every protected route reads `Authorization: Bearer <Firebase ID token>` and calls `adminAuth.verifyIdToken(token)`.

| Pattern | Who | How |
|---|---|---|
| **None** | Anyone | Public routes: `send-reset-code`, `reset-password`, `onboarding/submit`, `booking/inspection-request` |
| **Super admin** | Super admins only | `decoded.superAdmin === true` OR `role === "super_admin"` claim OR active doc in `super_admins/{uid}` |
| **Business owner** | Owners + admins | `businessId` JWT claim + `role` ∈ `"owner"` or `"admin"` — includes `GET`/`POST /api/inspection-requests`, team, services, notifications |
| **Super admin OR owner** | Either | `requireSession` — tries super admin first, then owner |
| **Optional session** | Anyone | Business logo upload (public onboarding also allowed) |
| **Customer** | Customers | Any Firebase Auth user with `email` on token (`authenticateCustomerRequest`) |

---

### `POST /api/auth/send-reset-code`

**Auth:** None (public)  
**File:** `app/api/auth/send-reset-code/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `generateCode()` | Returns a random 6-digit string (`100000`–`999999`) |
| `POST(req)` | Full reset code dispatch. Validates email format → `adminAuth.getUserByEmail` (returns `{ ok: true }` even if not found — anti-enumeration) → checks `passwordResetCodes/{email}` for 60s rate limit → generates code → writes to Firestore → calls `sendPasswordResetCodeEmail` |

**Request body:** `{ email: string }`  
**Firestore:** read + write `passwordResetCodes/{email}`  
**Firebase Auth:** `getUserByEmail`

---

### `POST /api/auth/reset-password`

**Auth:** None (requires valid code)  
**File:** `app/api/auth/reset-password/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `POST(req)` | Reads `passwordResetCodes/{email}` → checks not used, not expired, attempts ≤ 5 → compares code → `adminAuth.getUserByEmail` → `adminAuth.updateUser(uid, { password })` → marks `used: true` |

**Request body:** `{ email: string, code: string, newPassword: string }`  
**Firestore:** read + update + delete `passwordResetCodes/{email}`  
**Firebase Auth:** `getUserByEmail`, `updateUser`

---

### `GET /api/admin/tenants/list`

**Auth:** Super admin  
**File:** `app/api/admin/tenants/list/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `toMillis(value)` | Converts Firestore `Timestamp` to milliseconds |
| `mapTenantDoc(doc)` | Maps a `businesses` document snapshot to the `TenantDetail` API shape |
| `GET(request)` | `requireSuperAdmin` → reads `businesses` collection (ordered by `createdAt` desc, limit 100) → maps each doc |

**Returns:** `{ ok: true, tenants: TenantDetail[] }`  
**Firestore:** read `businesses`

---

### `POST /api/admin/tenants/create`

**Auth:** Super admin  
**File:** `app/api/admin/tenants/create/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `POST(request)` | `requireSuperAdmin` → validates payload → calls `createTenantFromPayload(payload, { source: "super_admin_create", status: "active", createdByUid, createdByEmail })` |

**Returns:** `{ ok, businessId, ownerId }` (201) or `{ error }` (400)  
**Delegates to:** `lib/onboarding/server.ts → createTenantFromPayload`

---

### `GET /api/admin/service-templates` · `POST /api/admin/service-templates`

**Auth:** Super admin  
**File:** `app/api/admin/service-templates/route.ts`

| Method | Function | Does |
|---|---|---|
| GET | `GET(request)` | `listServiceTemplates()` — reads all templates from `service_templates` (includes legacy task sub-docs) |
| POST | `POST(request)` | `createServiceTemplate(raw)` — writes new doc to `service_templates` with embedded `tasks[]` |

---

### `GET / PATCH / DELETE /api/admin/service-templates/[id]`

**Auth:** Super admin  
**File:** `app/api/admin/service-templates/[id]/route.ts`

| Method | Does | Firestore |
|---|---|---|
| GET | `getServiceTemplate(id)` | read `service_templates` |
| PATCH | `updateServiceTemplate(id, body)` — replaces tasks array | update `service_templates` |
| DELETE | `deleteServiceTemplate(id)` | delete `service_templates` |

---

### `GET /api/service-templates`

**Auth:** Super admin OR business owner  
**File:** `app/api/service-templates/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `GET(request)` | `requireSession` → super admin: all templates. Owner: `listServiceTemplates({ activeOnly: true, businessType })` filtered to their trade type |

**Firestore:** read `service_templates`, `businesses` (owner's trade type)

---

### `GET / POST /api/services`

**Auth:** Business owner/admin  
**File:** `app/api/services/route.ts`

| Method | Function | Does | Firestore |
|---|---|---|---|
| GET | `GET` | `listBusinessServices(businessId)` | read `services` |
| POST | `POST` | `createBusinessService(businessId, body)` | write `services`; read `service_templates`, `businesses` |

---

### `GET / PATCH / DELETE /api/services/[id]`

**Auth:** Business owner/admin  
**File:** `app/api/services/[id]/route.ts`

| Method | Does | Firestore |
|---|---|---|
| GET | `getBusinessService(id, businessId)` — ownership checked | read `services` |
| PATCH | `updateBusinessService(id, businessId, body)` — partial update, replaces tasks | update `services` |
| DELETE | `deleteBusinessService(id, businessId)` | delete `services` |

---

### `GET / PATCH /api/business/profile`

**Auth:** Business owner/admin  
**File:** `app/api/business/profile/route.ts`

| Method | Does | Firestore |
|---|---|---|
| GET | Returns `{ businessName, logoUrl }` | read `businesses` |
| PATCH | Updates `logoUrl` (empty string → `null`) | update `businesses` |

---

### `POST /api/uploads/business-logo`

**Auth:** Optional (public for onboarding, else owner session)  
**File:** `app/api/uploads/business-logo/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `POST(request)` | Reads multipart `file` → uploads to Firebase Storage path `business-logos/{businessId}/...` (owner) or `onboarding/...` (public) → returns `{ ok, imageUrl }` |

**Storage:** write only. No Firestore write (URL returned to caller who writes it).

---

### `POST /api/uploads/service-image`

**Auth:** Required session (super admin or owner)  
**File:** `app/api/uploads/service-image/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `POST(request)` | `requireSession` → reads `file` + `scope` (`"service-templates"` or `"services"`) → uploads to `service-templates/{uid}/...` or `services/{businessId}/...` → returns `{ ok, imageUrl }` |

---

### `GET / POST / PATCH / DELETE /api/team/staff`

**Auth:** Business owner/admin  
**File:** `app/api/team/staff/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `requireBusinessUser(request)` | Verifies Bearer token + `businessId` claim |
| `sanitizeString(v)` | Cleans raw string inputs |
| `sanitizeStringArray(v)` | Cleans raw array inputs |
| `parseAvailability(value, areas)` | Validates 7-day schedule; max 1 service area per day |
| `parseStaffPayload(raw, areas)` | Full create validation: name, email, phone, staffType, availability |
| `parseStaffUpdatePayload(raw, areas)` | Partial update validation |
| `parseStaffStatusPayload(raw)` | Status toggle: `active` or `suspended` |
| `getBusinessServiceAreas(businessId)` | Reads service areas from `businesses` |
| `availabilityForResponse(stored, areas)` | Maps stored availability to 7-day API shape |
| `getOwnedStaffRef(staffId, businessId)` | Gets staff doc ref; returns 404 if wrong business |

| Method | Does | Firebase |
|---|---|---|
| POST | Validates → `adminAuth.createUser` → `setCustomUserClaims({ role: "staff", businessId })` → writes `users/{uid}` → sends `sendStaffWelcomeEmail` | Auth + Firestore `users` |
| GET | Lists `users` where `businessId == x` and `role == "staff"` | Firestore `users` |
| PATCH | Status: `updateUser({ disabled })` + update `users`. Profile: update `users` doc | Auth + Firestore |
| DELETE | `adminAuth.deleteUser(uid)` + delete `users/{uid}` | Auth + Firestore |

**Default staff password:** `"00001111"` (staff must change after first login).

---

### `GET / POST /api/inspection-requests`

**Auth:** Business owner/admin  
**File:** `app/api/inspection-requests/route.ts`

**Functions:**

| Method | Does |
|---|---|
| `GET` | `listInspectionRequests(businessId)` → reads up to 80 requests from `inspection_requests` ordered by `createdAt` desc |
| `POST` | Owner creates an inspection on behalf of a customer (same body shape as public booking, **without** `slug`) |

**`POST` flow:**

1. `parseInspectionRequestInput(body)` — validates request type, customer, address, slots, notes, budget.
2. `ensureCustomerAccount({ email, fullName, phone, businessId, ... })` — see **`lib/customer/server.ts`** below.
   - If email is **not** in `customers/{uid}`: creates Firebase Auth user (password `00001111` when new login) + `customers` doc → sends **welcome email** (with password only when Auth user was created in this step).
   - If email **already** in `customers`: reuses `uid`; no welcome email.
3. `createInspectionRequest(businessId, input, { customerId })` — writes `inspection_requests` → **inspection notification emails** to business + customer (`notifyBusinessOfNewRequest`, `notifyCustomerOfNewRequest`).

**Emails sent on successful `POST` (new customer):**

| # | Email | Sender | When |
|---|---|---|---|
| 1 | Customer welcome (optional login card with `00001111`) | `system` | Email not already in `customers` collection |
| 2 | Inspection request received | `request` | Always (via `createInspectionRequest`) |

**Required `POST` body fields:** Same as public booking — `requestType`, `customer`, `address`, `preferredSlots` (1–3), optional `serviceId` / `customRequest`, `customerNotes`, `budgetAud`.

**Response:** `{ ok: true, requestId, request }` with HTTP `201`.

---

### `PATCH /api/inspection-requests/[id]`

**Auth:** Business owner/admin  
**File:** `app/api/inspection-requests/[id]/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `parseSlot(raw)` | Validates `{ date: YYYY-MM-DD, timeRange: morning/afternoon }` — must be a future date |
| `parseWindow(payload)` | Validates `startTime` + `endTime` (24h `HH:MM`, end must be after start) |
| `dedupeSlots(slots)` | Removes duplicate slots; enforces max 3 |
| `resolveStaffAssignment(businessId, staffId)` | Reads `users/{staffId}` and verifies they belong to the business |
| `resolveOwnerAssignment(uid, email)` | Builds owner assignee object from claims |
| `PATCH` | Parses `action` then calls `applyOwnerAction` |

**Available actions:**

| Action | Transitions to | What it sets |
|---|---|---|
| `accept` | `scheduled` | `scheduledSlot`, `scheduledStartTime`, `scheduledEndTime`, `ownerNote` |
| `set_time` | stays `scheduled` | `scheduledStartTime`, `scheduledEndTime` (already scheduled only) |
| `propose` | `owner_proposed` | `ownerProposedSlots` (1–3 future slots) |
| `assign` | stays current | `assignedTo` (owner or staff) — only if `scheduled` |
| `cancel` | `cancelled` | — |
| `complete` | `completed` | — |

---

### `POST /api/booking/inspection-request`

**Auth:** None required (optional customer Bearer token)  
**File:** `app/api/booking/inspection-request/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `readCustomerUid(request)` | Tries to verify Bearer token; returns `uid` or `null` (never throws) |
| `resolveBusinessIdFromSlug(slug)` | Queries `businesses` where `bookingSlug == slug` → returns `businessId` |
| `POST(req)` | Parse + validate booking request → `createInspectionRequest(businessId, input, { customerId? })` |

**Required body fields:** `slug`, customer contact, address, at least 1 preferred slot.

> **Owner vs public:** Business owners use **`POST /api/inspection-requests`** (no `slug`; auto-creates customer with default password `00001111` + welcome email when new). Public customers use this route with `slug` and optional sign-in.

---

### `GET / PATCH / DELETE /api/notifications`

**Auth:** Business owner/admin  
**File:** `app/api/notifications/route.ts`

| Method | Function called | Does |
|---|---|---|
| GET | `listBusinessNotifications(businessId)` | Returns up to 50 notifications ordered by `createdAt` desc |
| PATCH | `markAllNotificationsRead({ audience: "business", businessId })` | Batch-updates all unread to `read: true` |
| DELETE | `deleteAllNotifications({ audience: "business", businessId })` | Deletes all docs in list |

---

### `PATCH / DELETE /api/notifications/[id]`

**Auth:** Business owner/admin  
**File:** `app/api/notifications/[id]/route.ts`

| Method | Function called | Does |
|---|---|---|
| PATCH | `markNotificationRead(id, guard)` | Sets `read: true` on one notification |
| DELETE | `deleteNotification(id, guard)` | Deletes one notification doc |

---

### `GET / PATCH /api/customer/profile`

**Auth:** Customer Bearer token  
**File:** `app/api/customer/profile/route.ts`

| Method | Does |
|---|---|
| GET | `getOrCreateCustomerProfile(customer, { bookingSlug? })` — creates profile if first visit |
| PATCH | Validates `fullName`, `phone` → `updateCustomerProfile` — sends welcome email once if not yet sent |

---

### `GET /api/customer/bookings`

**Auth:** Customer Bearer token  
**File:** `app/api/customer/bookings/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `mapBookingDoc(doc)` | Maps `inspection_requests` doc → `InspectionRequestDetail` |
| `loadBusinessSummaries(ids)` | Batch reads `businesses` docs → name + slug map |
| `GET` | Queries `inspection_requests` by `customerId` AND by `customer.email` → merges, deduplicates → attaches business names |

---

### `PATCH /api/customer/bookings/[id]`

**Auth:** Customer Bearer token  
**File:** `app/api/customer/bookings/[id]/route.ts`

| Action | Function | Does |
|---|---|---|
| `accept_proposed` | `customerAcceptProposedSlot(id, identity, slot)` | Validates customer owns request → moves `owner_proposed` → `scheduled` → notifies business |

---

### `GET / PATCH / DELETE /api/customer/notifications`

**Auth:** Customer Bearer token  
**File:** `app/api/customer/notifications/route.ts`

| Method | Does |
|---|---|
| GET | `listCustomerNotifications(uid, email)` — merges results from both `customerId` and `customerEmail` queries |
| PATCH | `markAllNotificationsRead` on customer collection |
| DELETE | `deleteAllNotifications` on customer collection |

---

### `PATCH / DELETE /api/customer/notifications/[id]`

**Auth:** Customer Bearer token  
**File:** `app/api/customer/notifications/[id]/route.ts`

| Method | Does |
|---|---|
| PATCH | `markNotificationRead` — marks one notification read |
| DELETE | `deleteNotification` — deletes one notification |

---

### `POST /api/onboarding/submit`

**Auth:** None (public self-signup)  
**File:** `app/api/onboarding/submit/route.ts`

**Functions:**

| Function | Does |
|---|---|
| `POST(request)` | Parses registration body → `registerSelfSignupTenant(body)` → 201 on success, 400 on validation error |

**Delegates to:** `lib/onboarding/server.ts → registerSelfSignupTenant`

---

### Lib Server Functions

#### `lib/onboarding/server.ts`

| Function | Params | Does | Firestore / Auth |
|---|---|---|---|
| `requireSuperAdmin(req)` | `Request` | Verifies Bearer token; checks `superAdmin` claim OR `role === "super_admin"` OR `super_admins/{uid}` doc is active | Auth verify; read `super_admins` |
| `reserveBookingSlug(name)` | business name | Slugifies name; checks uniqueness against existing `businesses.bookingSlug`; appends number if taken | read `businesses` |
| `createTenantFromPayload(raw, options)` | payload + options | Validates payload (no password needed); calls `createTenantWithOwnerAccount` | delegates |
| `registerSelfSignupTenant(raw)` | payload with password | Requires password; `source: "self_signup"`; calls `createTenantWithOwnerAccount` | delegates |
| `createTenantWithOwnerAccount` *(private)* | payload + options | `adminAuth.createUser` → `setCustomUserClaims({ role: "owner", businessId })` → write `businesses/{id}` → write `users/{uid}` → `sendOwnerWelcomeEmail` → rollback on error (`deleteUser`) | Auth; write `businesses`, `users` |
| `getBusinessProfile(businessId)` | string | Returns `{ businessName, logoUrl }` or `null` | read `businesses` |
| `updateBusinessLogo(businessId, logoUrl)` | ids | Updates `logoUrl` field | update `businesses` |

---

#### `lib/inspection/server.ts`

| Function | Params | Does | Firestore |
|---|---|---|---|
| `loadBusinessSummary(businessId)` | string | Reads `businessName`, `bookingSlug`, `logoUrl` | read `businesses` |
| `lookupService(businessId, serviceId)` | ids | Returns `serviceName` + `serviceBusinessType` or null | read `services` |
| `createInspectionRequest(businessId, input, opts)` | business ID, validated input, `{ customerId? }` | Creates `pending` request → notifies business + customer | write `inspection_requests`; read `businesses`, `services` |
| `listInspectionRequests(businessId)` | string | Reads up to 80 requests ordered `createdAt` desc | read `inspection_requests` |
| `getInspectionRequest(id, businessId)` | ids | Reads one request; verifies business ownership | read `inspection_requests` |
| `applyOwnerAction(id, businessId, action)` | `OwnerAction` | Status transitions + side-effects (see table below) | update `inspection_requests`; side-effects via notifications |
| `customerAcceptProposedSlot(id, identity, slot)` | customer identity + slot | `owner_proposed` → `scheduled`; notifies business | update `inspection_requests` |

**`applyOwnerAction` transitions:**

| Action | From | To | Side-effects |
|---|---|---|---|
| `accept` | any | `scheduled` | Sets slot + times + note; `notifyCustomerOfStatusChange` |
| `set_time` | `scheduled` | `scheduled` | Updates times only |
| `propose` | any | `owner_proposed` | Sets proposal slots; `notifyCustomerOfStatusChange` |
| `assign` | `scheduled` | `scheduled` | Sets `assignedTo`; `notifyCustomerOfAssignment` |
| `cancel` | any | `cancelled` | `notifyCustomerOfStatusChange` |
| `complete` | any | `completed` | `notifyCustomerOfStatusChange` |

---

#### `lib/notifications/server.ts`

| Function | Does | Firestore |
|---|---|---|
| `notifyBusinessOfNewRequest(request, ctx)` | Creates `request_created` business notification | write `business_notifications` |
| `notifyCustomerOfNewRequest(request, ctx)` | Creates `request_created` customer notification | write `customer_notifications` |
| `notifyCustomerOfStatusChange(request, nextStatus, ctx)` | Creates status-change notification (scheduled/proposed/cancelled/completed) | write `customer_notifications` |
| `notifyCustomerOfAssignment(request, ctx)` | Creates `request_assigned` notification | write `customer_notifications` |
| `notifyBusinessOfCustomerAcceptance(request, ctx)` | Creates `request_scheduled` notification on business side | write `business_notifications` |
| `sendCustomerNotificationEmail(input)` *(private)* | Builds HTML via `renderEmail()` + sends ZeptoMail (`request` sender) | ZeptoMail |
| `listBusinessNotifications(businessId)` | Reads up to 50 notifications desc | read `business_notifications` |
| `listCustomerNotifications(uid, email)` | Reads by `customerId` + `customerEmail`, deduplicates | read `customer_notifications` |
| `markNotificationRead(id, guard)` | Updates `read: true` with ownership check | update collection |
| `markAllNotificationsRead(guard)` | Batch updates all unread | update collection |
| `deleteNotification(id, guard)` | Deletes one doc with ownership check | delete |
| `deleteAllNotifications(guard)` | Deletes all in list | delete |

---

#### `lib/customer/server.ts`

| Constant / function | Does | Firestore / Auth |
|---|---|---|
| `DEFAULT_CUSTOMER_PASSWORD` | `"00001111"` — used when owner auto-creates a customer login | — |
| `ensureCustomerAccount(input)` | Ensures `customers/{uid}` exists for email; creates Auth + profile if needed; welcome email when **new to `customers`** | Auth create/read; read/write `customers`; ZeptoMail |
| `authenticateCustomerRequest(request)` | Verifies Bearer token; returns `{ uid, email }` | Auth verify |
| `resolveBusinessByBookingSlug(slug)` | Queries `businesses` where `bookingSlug == slug` | read `businesses` |
| `getOrCreateCustomerProfile(customer, opts)` | Reads `customers/{uid}`; creates if missing; syncs email field | read/write `customers` |
| `updateCustomerProfile(customer, input)` | Updates `fullName`, `phone`; sends welcome email once | read/write `customers`; read `businesses` |
| `attachRegistrationBusinessIfEmpty(uid, slug?)` | Sets `registeredBusinessId` etc. on first-touch | read/write `customers`, read `businesses` |

**`ensureCustomerAccount` details:**

- Looks up email in Firebase Auth; on `auth/user-not-found`, creates user with `DEFAULT_CUSTOMER_PASSWORD`.
- Writes or merges `customers/{uid}` with `fullName`, `phone`, `registeredBusinessId`, etc.
- If the email was **not** already in `customers`: calls `sendCustomerWelcomeEmail` with `temporaryPassword: "00001111"` only when Auth user was created in this call; sets `welcomeEmailSent: true`.
- Returns `{ uid, email, created }` where `created` means a new Auth user was created (not the same as “new to customers”).

---

#### `lib/onboarding/services/server.ts`

**Auth helpers:**

| Function | Does |
|---|---|
| `requireBusinessOwner(req)` | Bearer verify; needs `businessId` + `role` ∈ `owner`/`admin` |
| `requireSession(req)` | Tries `requireSuperAdmin`, then `requireBusinessOwner` |

**Service templates:**

| Function | Does | Firestore |
|---|---|---|
| `listServiceTemplates(opts?)` | All templates (+ legacy task reads); filter by `activeOnly`, `businessType` | read `service_templates`, `service_template_tasks` |
| `getServiceTemplate(id)` | One template with tasks | read `service_templates` |
| `createServiceTemplate(raw)` | Validates + writes with embedded `tasks[]` | write `service_templates` |
| `updateServiceTemplate(id, raw)` | Full replace including tasks | update `service_templates` |
| `deleteServiceTemplate(id)` | Deletes doc | delete `service_templates` |

**Business services:**

| Function | Does | Firestore |
|---|---|---|
| `listBusinessServices(businessId)` | All services for a business | read `services` |
| `getBusinessService(id, businessId)` | One service; ownership checked | read `services` |
| `createBusinessService(businessId, raw)` | Validates; optionally copies tasks from template | write `services`; read `service_templates`, `businesses` |
| `updateBusinessService(id, businessId, raw)` | Partial update; replaces tasks | update `services` |
| `deleteBusinessService(id, businessId)` | Ownership check then delete | delete `services` |

---

## 9. Route Flow Diagrams

Every route shown as: **Request → Auth → Functions → Database/External**

---

### `POST /api/auth/send-reset-code`

```
Client
  │
  ├── POST /api/auth/send-reset-code
  │     body: { email }
  │
  ├── [No Auth Required]
  │
  ├── generateCode()
  │     └── returns random 6-digit string
  │
  ├── adminAuth.getUserByEmail(email)          ──► Firebase Auth
  │     └── user NOT found → return { ok: true }   (anti-enumeration)
  │     └── user found → continue
  │
  ├── adminDb.collection("passwordResetCodes")
  │     .doc(email).get()                      ──► Firestore READ
  │     └── doc exists AND createdAt < 60s ago
  │           → return 429 (rate limited)
  │
  ├── adminDb.collection("passwordResetCodes")
  │     .doc(email).set({                      ──► Firestore WRITE
  │       code, expiresAt (+15min),
  │       createdAt, attempts: 0, used: false
  │     })
  │
  ├── sendPasswordResetCodeEmail({ email, code })
  │     └── renderEmail(...)
  │     └── sendEmail({ sender: "system", ... })  ──► ZeptoMail API
  │
  └── return { ok: true }
```

---

### `POST /api/auth/reset-password`

```
Client
  │
  ├── POST /api/auth/reset-password
  │     body: { email, code, newPassword }
  │
  ├── [No Auth Required]
  │
  ├── Validate: email, code, newPassword present
  │     └── newPassword.length < 8 → return 400
  │
  ├── adminDb.collection("passwordResetCodes")
  │     .doc(email).get()                      ──► Firestore READ
  │     ├── doc not found → return 400 "Invalid or expired code"
  │     ├── used === true → return 400
  │     ├── expiresAt < now → delete doc → return 400
  │     ├── attempts > 5 → delete doc → return 400
  │     └── code mismatch → update { attempts++ } → return 400
  │
  ├── adminAuth.getUserByEmail(email)          ──► Firebase Auth READ
  │     └── not found → return 400
  │
  ├── adminAuth.updateUser(uid, { password })  ──► Firebase Auth WRITE
  │
  ├── adminDb.collection("passwordResetCodes")
  │     .doc(email).update({ used: true })     ──► Firestore WRITE
  │
  └── return { ok: true }
```

---

### `GET /api/admin/tenants/list`

```
Client (super admin)
  │
  ├── GET /api/admin/tenants/list
  │     headers: Authorization: Bearer <ID token>
  │
  ├── requireSuperAdmin(request)
  │     ├── adminAuth.verifyIdToken(token)     ──► Firebase Auth VERIFY
  │     ├── decoded.superAdmin === true? → pass
  │     ├── decoded.role === "super_admin"? → pass
  │     └── adminDb.collection("super_admins")
  │           .doc(uid).get()                  ──► Firestore READ
  │               └── isActive === false → 403
  │
  ├── adminDb.collection("businesses")
  │     .orderBy("createdAt", "desc")
  │     .limit(100).get()                      ──► Firestore READ
  │
  ├── mapTenantDoc(doc) for each               (in-memory transform)
  │
  └── return { ok: true, tenants: TenantDetail[] }
```

---

### `POST /api/admin/tenants/create`

```
Client (super admin)
  │
  ├── POST /api/admin/tenants/create
  │     body: OnboardingPayload
  │
  ├── requireSuperAdmin(request)               ──► Firebase Auth VERIFY
  │                                            ──► Firestore READ super_admins
  │
  ├── createTenantFromPayload(payload, {
  │     source: "super_admin_create",
  │     status: "active",
  │     createdByUid, createdByEmail
  │   })
  │   └── createTenantWithOwnerAccount()
  │         ├── reserveBookingSlug(name)
  │         │     └── adminDb query businesses
  │         │           where bookingSlug == slug  ──► Firestore READ
  │         │
  │         ├── adminAuth.createUser({            ──► Firebase Auth WRITE
  │         │     email, password
  │         │   })
  │         │
  │         ├── adminAuth.setCustomUserClaims(    ──► Firebase Auth WRITE
  │         │     uid, { role: "owner", businessId }
  │         │   )
  │         │
  │         ├── adminDb.collection("businesses")
  │         │     .doc(businessId).set({...})     ──► Firestore WRITE
  │         │
  │         ├── adminDb.collection("users")
  │         │     .doc(uid).set({...})            ──► Firestore WRITE
  │         │
  │         ├── sendOwnerWelcomeEmail(...)        ──► ZeptoMail API
  │         │
  │         └── [on error] adminAuth.deleteUser() ──► Firebase Auth DELETE (rollback)
  │
  └── return { ok, businessId, ownerId } 201
```

---

### `GET /api/admin/service-templates`

```
Client (super admin)
  │
  ├── GET /api/admin/service-templates
  │
  ├── requireSuperAdmin(request)               ──► Firebase Auth VERIFY
  │                                            ──► Firestore READ super_admins
  │
  ├── listServiceTemplates()
  │     ├── adminDb.collection("service_templates").get()  ──► Firestore READ
  │     └── for each template lacking tasks[]:
  │           adminDb.collection("service_template_tasks")
  │                 .where("templateId","==",id).get()     ──► Firestore READ (legacy)
  │
  └── return { ok: true, templates: [] }
```

---

### `POST /api/admin/service-templates`

```
Client (super admin)
  │
  ├── POST /api/admin/service-templates
  │     body: { name, businessType, tasks[], isActive }
  │
  ├── requireSuperAdmin(request)               ──► Firebase Auth VERIFY
  │
  ├── createServiceTemplate(raw)
  │     ├── validate fields
  │     ├── build embedded tasks[] array
  │     └── adminDb.collection("service_templates")
  │             .add({ ...fields, tasks[], createdAt, updatedAt }) ──► Firestore WRITE
  │
  └── return { ok: true, templateId, template } 201
```

---

### `GET / PATCH / DELETE /api/admin/service-templates/[id]`

```
Client (super admin)
  │
  ├── requireSuperAdmin(request)               ──► Firebase Auth VERIFY
  │
  ├── GET  → getServiceTemplate(id)
  │     └── adminDb.collection("service_templates").doc(id).get()  ──► Firestore READ
  │
  ├── PATCH → updateServiceTemplate(id, body)
  │     └── adminDb.collection("service_templates")
  │             .doc(id).set({...updated, updatedAt})              ──► Firestore WRITE
  │
  └── DELETE → deleteServiceTemplate(id)
        └── adminDb.collection("service_templates").doc(id).delete() ──► Firestore DELETE
```

---

### `GET /api/service-templates`

```
Client (super admin OR business owner)
  │
  ├── GET /api/service-templates
  │
  ├── requireSession(request)
  │     ├── try requireSuperAdmin() → pass if super admin
  │     └── else requireBusinessOwner()        ──► Firebase Auth VERIFY
  │
  ├── [if business owner]
  │     adminDb.collection("businesses").doc(businessId).get()  ──► Firestore READ
  │     └── get businessType for filter
  │
  ├── listServiceTemplates({ activeOnly: true, businessType })
  │     └── adminDb.collection("service_templates")
  │             .where("isActive","==",true)
  │             .where("businessType","==",type).get()           ──► Firestore READ
  │
  └── return { ok: true, templates: [], businessType }
```

---

### `GET / POST /api/services`

```
Client (business owner)
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │     └── reads businessId from JWT claims
  │
  ├── GET → listBusinessServices(businessId)
  │     └── adminDb.collection("services")
  │             .where("businessId","==",id).get()               ──► Firestore READ
  │
  └── POST → createBusinessService(businessId, body)
        ├── validate input
        ├── [if templateId] getServiceTemplate(templateId)
        │     └── adminDb.collection("service_templates")        ──► Firestore READ
        ├── adminDb.collection("businesses")
        │     .doc(businessId).get()                             ──► Firestore READ
        │     └── verify trade type match
        └── adminDb.collection("services").add({...})            ──► Firestore WRITE
```

---

### `GET / PATCH / DELETE /api/services/[id]`

```
Client (business owner)
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │
  ├── GET → getBusinessService(id, businessId)
  │     └── adminDb.collection("services").doc(id).get()  ──► Firestore READ
  │           └── businessId mismatch → 404
  │
  ├── PATCH → updateBusinessService(id, businessId, body)
  │     └── adminDb.collection("services").doc(id)
  │             .update({...partial, tasks[], updatedAt})   ──► Firestore WRITE
  │
  └── DELETE → deleteBusinessService(id, businessId)
        └── adminDb.collection("services").doc(id).delete() ──► Firestore DELETE
```

---

### `GET / PATCH /api/business/profile`

```
Client (business owner)
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │
  ├── GET
  │     └── adminDb.collection("businesses").doc(businessId).get() ──► Firestore READ
  │           └── return { businessName, logoUrl }
  │
  └── PATCH  body: { logoUrl? }
        └── adminDb.collection("businesses").doc(businessId)
                .update({ logoUrl, updatedAt })                    ──► Firestore WRITE
```

---

### `POST /api/uploads/business-logo`

```
Client
  │
  ├── POST /api/uploads/business-logo
  │     body: multipart form-data { file }
  │
  ├── [Optional session] try requireSession()  ──► Firebase Auth VERIFY (optional)
  │     ├── authenticated owner → path: business-logos/{businessId}/...
  │     └── unauthenticated     → path: onboarding/{timestamp}/...
  │
  ├── validate file is a File
  │
  ├── adminStorage.bucket().file(path)
  │     .save(buffer, { metadata })            ──► Firebase Storage WRITE
  │
  ├── file.makePublic()
  │
  └── return { ok: true, imageUrl: "https://storage.googleapis.com/..." }
```

---

### `POST /api/uploads/service-image`

```
Client
  │
  ├── POST /api/uploads/service-image
  │     body: multipart form-data { file, scope }
  │     scope: "service-templates" | "services"
  │
  ├── requireSession(request)                  ──► Firebase Auth VERIFY
  │     └── scope "services" requires business_owner role
  │
  ├── path:
  │     "service-templates" → service-templates/{uid}/...
  │     "services"          → services/{businessId}/...
  │
  ├── adminStorage.bucket().file(path).save()  ──► Firebase Storage WRITE
  │
  └── return { ok: true, imageUrl }
```

---

### `GET / POST / PATCH / DELETE /api/team/staff`

```
Client (business owner)
  │
  ├── requireBusinessUser(request)             ──► Firebase Auth VERIFY
  │
  ├── GET
  │     ├── adminDb.collection("users")
  │     │     .where("businessId","==",id)
  │     │     .where("role","==","staff").get()          ──► Firestore READ
  │     └── adminDb.collection("businesses").doc(id).get() ──► Firestore READ (service areas)
  │
  ├── POST  body: { fullName, email, phone, staffType, availability }
  │     ├── getBusinessServiceAreas(businessId)          ──► Firestore READ businesses
  │     ├── parseStaffPayload(raw, areas)      (validate)
  │     ├── check duplicate email in users collection    ──► Firestore READ
  │     ├── adminAuth.createUser({ email, password: "00001111" })  ──► Firebase Auth WRITE
  │     ├── adminAuth.setCustomUserClaims(uid, {         ──► Firebase Auth WRITE
  │     │     role: "staff", businessId
  │     │   })
  │     ├── adminDb.collection("users").doc(uid).set({}) ──► Firestore WRITE
  │     └── sendStaffWelcomeEmail(...)                   ──► ZeptoMail API
  │
  ├── PATCH  body: { id, status? } OR { id, fullName, ... }
  │     ├── getOwnedStaffRef(id, businessId)             ──► Firestore READ (ownership)
  │     ├── [status update]
  │     │     ├── adminAuth.updateUser(uid, { disabled }) ──► Firebase Auth WRITE
  │     │     └── adminDb.collection("users").doc(id)
  │     │           .update({ status, isActive })        ──► Firestore WRITE
  │     └── [profile update]
  │           └── adminDb.collection("users").doc(id).update({}) ──► Firestore WRITE
  │
  └── DELETE  ?id=staffId
        ├── getOwnedStaffRef(id, businessId)             ──► Firestore READ (ownership)
        ├── adminAuth.deleteUser(uid)                    ──► Firebase Auth DELETE
        └── adminDb.collection("users").doc(id).delete() ──► Firestore DELETE
```

---

### `GET / POST /api/inspection-requests`

```
Client (business owner)
  │
  ├── GET /api/inspection-requests
  │     ├── requireBusinessOwner(request)      ──► Firebase Auth VERIFY
  │     ├── listInspectionRequests(businessId)
  │     │     └── adminDb.collection("inspection_requests")
  │     │             .where("businessId","==",id)
  │     │             .limit(80).get()         ──► Firestore READ
  │     └── return { ok: true, requests }
  │
  └── POST /api/inspection-requests
        │     body: { requestType, customer, address, preferredSlots, ... }
        │
        ├── requireBusinessOwner(request)      ──► Firebase Auth VERIFY
        │
        ├── parseInspectionRequestInput(body)  (validate)
        │
        ├── adminDb.collection("businesses").doc(businessId).get()  ──► Firestore READ
        │
        ├── ensureCustomerAccount({ email, fullName, phone, businessId, ... })
        │     ├── adminAuth.getUserByEmail(email)              ──► Firebase Auth READ
        │     ├── [if not found]
        │     │     adminAuth.createUser({ password: "00001111" }) ──► Firebase Auth WRITE
        │     ├── adminDb.collection("customers").doc(uid)
        │     │     .get() / .set() / merge                    ──► Firestore READ/WRITE
        │     └── [if new to customers collection]
        │           sendCustomerWelcomeEmail({ temporaryPassword? }) ──► ZeptoMail (system)
        │
        ├── createInspectionRequest(businessId, input, { customerId })
        │     ├── adminDb.collection("inspection_requests").add() ──► Firestore WRITE
        │     ├── notifyBusinessOfNewRequest()                 ──► Firestore + email
        │     └── notifyCustomerOfNewRequest()                 ──► Firestore + email
        │
        └── return { ok: true, requestId, request }  (201)
```

---

### `PATCH /api/inspection-requests/[id]`

```
Client (business owner)
  │
  ├── PATCH /api/inspection-requests/{id}
  │     body: { action, ...actionParams }
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │
  ├── parse action params:
  │     parseSlot() / parseWindow() / dedupeSlots()   (validate)
  │
  ├── [action === "assign"]
  │     └── resolveStaffAssignment(businessId, staffId)
  │           └── adminDb.collection("users").doc(staffId).get()  ──► Firestore READ
  │
  ├── applyOwnerAction(id, businessId, action)
  │     ├── adminDb.collection("inspection_requests")
  │     │     .doc(id).get()                   ──► Firestore READ
  │     │
  │     ├── validate status transition
  │     │
  │     ├── adminDb.collection("inspection_requests")
  │     │     .doc(id).update({ status, ...fields, updatedAt }) ──► Firestore WRITE
  │     │
  │     ├── loadBusinessSummary(businessId)
  │     │     └── adminDb.collection("businesses")              ──► Firestore READ
  │     │
  │     └── notify customer:
  │           └── adminDb.collection("customer_notifications")
  │                 .add({...})                                  ──► Firestore WRITE
  │
  └── return { ok: true, request }
```

---

### `POST /api/booking/inspection-request`

```
Customer / Anonymous
  │
  ├── POST /api/booking/inspection-request
  │     body: { slug, customer, address, preferredSlots, serviceId? }
  │
  ├── [Optional] readCustomerUid(request)
  │     └── adminAuth.verifyIdToken(token)     ──► Firebase Auth VERIFY (optional)
  │
  ├── resolveBusinessIdFromSlug(slug)
  │     └── adminDb.collection("businesses")
  │             .where("bookingSlug","==",slug).get()  ──► Firestore READ
  │
  ├── parseInspectionRequestInput(body)        (validate)
  │
  ├── createInspectionRequest(businessId, input, { customerId })
  │     ├── [if serviceId] lookupService(businessId, serviceId)
  │     │     └── adminDb.collection("services").doc(id).get()  ──► Firestore READ
  │     │
  │     ├── adminDb.collection("inspection_requests").add({     ──► Firestore WRITE
  │     │     status: "pending", ...fields
  │     │   })
  │     │
  │     ├── loadBusinessSummary(businessId)                     ──► Firestore READ businesses
  │     │
  │     ├── notifyBusinessOfNewRequest()
  │     │     └── adminDb.collection("business_notifications").add() ──► Firestore WRITE
  │     │
  │     └── notifyCustomerOfNewRequest()
  │           └── adminDb.collection("customer_notifications").add() ──► Firestore WRITE
  │
  └── return { ok: true, requestId }
```

---

### `GET / PATCH / DELETE /api/notifications`

```
Client (business owner)
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │
  ├── GET → listBusinessNotifications(businessId)
  │     └── adminDb.collection("business_notifications")
  │             .where("businessId","==",id)
  │             .orderBy("createdAt","desc")
  │             .limit(50).get()               ──► Firestore READ
  │
  ├── PATCH → markAllNotificationsRead({ audience:"business", businessId })
  │     └── batch: all unread docs
  │           .update({ read: true })          ──► Firestore WRITE (batch)
  │
  └── DELETE → deleteAllNotifications({ audience:"business", businessId })
        └── batch: delete all docs             ──► Firestore DELETE (batch)
```

---

### `PATCH / DELETE /api/notifications/[id]`

```
Client (business owner)
  │
  ├── requireBusinessOwner(request)            ──► Firebase Auth VERIFY
  │
  ├── PATCH → markNotificationRead(id, { audience:"business", businessId })
  │     ├── adminDb.collection("business_notifications")
  │     │     .doc(id).get()                   ──► Firestore READ (ownership check)
  │     └── .update({ read: true })            ──► Firestore WRITE
  │
  └── DELETE → deleteNotification(id, guard)
        ├── adminDb...doc(id).get()             ──► Firestore READ (ownership check)
        └── .delete()                           ──► Firestore DELETE
```

---

### `GET / PATCH /api/customer/profile`

```
Customer
  │
  ├── Authorization: Bearer <customer ID token>
  │
  ├── authenticateCustomerRequest(request)
  │     └── adminAuth.verifyIdToken(token)     ──► Firebase Auth VERIFY
  │           └── extracts uid, email
  │
  ├── GET  ?bookingSlug=...
  │     ├── getOrCreateCustomerProfile(customer, { bookingSlug })
  │     │     ├── adminDb.collection("customers").doc(uid).get() ──► Firestore READ
  │     │     ├── [not found] → adminDb.collection("customers")
  │     │     │                   .doc(uid).set({...})           ──► Firestore WRITE
  │     │     └── attachRegistrationBusinessIfEmpty(uid, slug)
  │     │           ├── adminDb.collection("businesses")
  │     │           │     .where("bookingSlug","==",slug).get()  ──► Firestore READ
  │     │           └── adminDb.collection("customers")
  │     │                 .doc(uid).update({ registeredBusinessId,... }) ──► Firestore WRITE
  │     └── return CustomerProfile
  │
  └── PATCH  body: { fullName, phone }
        ├── validateCustomerProfileInput(body)
        ├── updateCustomerProfile(customer, input)
        │     ├── adminDb.collection("customers").doc(uid).get() ──► Firestore READ
        │     ├── adminDb.collection("customers").doc(uid)
        │     │     .update({ fullName, phone, updatedAt })      ──► Firestore WRITE
        │     └── [welcomeEmailSent === false]
        │           └── sendCustomerWelcomeEmail(...)            ──► ZeptoMail API
        │           └── adminDb...update({ welcomeEmailSent: true }) ──► Firestore WRITE
        └── return updated CustomerProfile
```

---

### `GET /api/customer/bookings`

```
Customer
  │
  ├── authenticateCustomerRequest(request)     ──► Firebase Auth VERIFY
  │
  ├── Query 1: adminDb.collection("inspection_requests")
  │     .where("customerId","==",uid).get()    ──► Firestore READ
  │
  ├── Query 2: adminDb.collection("inspection_requests")
  │     .where("customer.email","==",email).get() ──► Firestore READ
  │
  ├── merge + deduplicate by doc ID            (in-memory)
  │
  ├── loadBusinessSummaries(businessIds)
  │     └── adminDb.collection("businesses")
  │             .where(FieldPath.documentId(),"in",[...]).get() ──► Firestore READ
  │
  └── return { ok: true, bookings: InspectionRequestDetail[] }
```

---

### `PATCH /api/customer/bookings/[id]`

```
Customer
  │
  ├── authenticateCustomerRequest(request)     ──► Firebase Auth VERIFY
  │
  ├── body: { action: "accept_proposed", slot }
  │
  ├── customerAcceptProposedSlot(id, { uid, email }, slot)
  │     ├── adminDb.collection("inspection_requests")
  │     │     .doc(id).get()                   ──► Firestore READ
  │     │     └── verify customer ownership (uid or email match)
  │     │     └── verify status === "owner_proposed"
  │     │
  │     ├── adminDb.collection("inspection_requests")
  │     │     .doc(id).update({                ──► Firestore WRITE
  │     │       status: "scheduled",
  │     │       scheduledSlot: slot,
  │     │       updatedAt
  │     │     })
  │     │
  │     └── notifyBusinessOfCustomerAcceptance()
  │           └── adminDb.collection("business_notifications")
  │                 .add({...})                ──► Firestore WRITE
  │
  └── return { ok: true, request }
```

---

### `GET / PATCH / DELETE /api/customer/notifications`

```
Customer
  │
  ├── authenticateCustomerRequest(request)     ──► Firebase Auth VERIFY
  │
  ├── GET → listCustomerNotifications(uid, email)
  │     ├── adminDb.collection("customer_notifications")
  │     │     .where("customerId","==",uid).get()    ──► Firestore READ
  │     ├── adminDb.collection("customer_notifications")
  │     │     .where("customerEmail","==",email).get() ──► Firestore READ
  │     └── merge + deduplicate                (in-memory)
  │
  ├── PATCH → markAllNotificationsRead (customer guard)
  │     └── batch update { read: true }        ──► Firestore WRITE (batch)
  │
  └── DELETE → deleteAllNotifications (customer guard)
        └── batch delete all                   ──► Firestore DELETE (batch)
```

---

### `PATCH / DELETE /api/customer/notifications/[id]`

```
Customer
  │
  ├── authenticateCustomerRequest(request)     ──► Firebase Auth VERIFY
  │
  ├── PATCH → markNotificationRead(id, customerGuard)
  │     └── adminDb.collection("customer_notifications")
  │           .doc(id).get()                   ──► Firestore READ (ownership)
  │           .update({ read: true })          ──► Firestore WRITE
  │
  └── DELETE → deleteNotification(id, customerGuard)
        └── .doc(id).delete()                  ──► Firestore DELETE
```

---

### `POST /api/onboarding/submit`

```
Anonymous (public self-signup)
  │
  ├── POST /api/onboarding/submit
  │     body: OnboardingPayload + password
  │
  ├── [No Auth Required]
  │
  ├── registerSelfSignupTenant(body)
  │     └── createTenantWithOwnerAccount(payload, {
  │           source: "self_signup", status: "active"
  │         })
  │         ├── reserveBookingSlug(name)
  │         │     └── adminDb query businesses  ──► Firestore READ
  │         │
  │         ├── adminAuth.createUser(...)        ──► Firebase Auth WRITE
  │         ├── adminAuth.setCustomUserClaims(   ──► Firebase Auth WRITE
  │         │     uid, { role: "owner", businessId }
  │         │   )
  │         ├── adminDb.collection("businesses")
  │         │     .doc(id).set({...})            ──► Firestore WRITE
  │         ├── adminDb.collection("users")
  │         │     .doc(uid).set({...})           ──► Firestore WRITE
  │         ├── sendOwnerWelcomeEmail(...)        ──► ZeptoMail API
  │         └── [on error] adminAuth.deleteUser() ──► Firebase Auth DELETE (rollback)
  │
  └── return { ok, businessId, ownerId } 201
```

---

### Overall System Data Flow

```
                        ┌─────────────────────────────────────────┐
                        │           CLIENTS                        │
                        │  Admin Browser  │  Customer Browser      │
                        └────────┬────────┴──────────┬────────────┘
                                 │ Bearer Token       │ Bearer Token
                                 ▼                    ▼
                        ┌────────────────────────────────────────┐
                        │         NEXT.JS APP ROUTER              │
                        │   app/api/** Route Handlers             │
                        └───┬─────────────────────┬──────────────┘
                            │                     │
              ┌─────────────▼────────┐   ┌────────▼──────────────┐
              │   lib/onboarding     │   │   lib/inspection       │
              │   lib/customer       │   │   lib/notifications    │
              │   lib/onboarding/    │   │   lib/onboarding/      │
              │   services           │   │   services (auth)      │
              └──┬───────────────────┘   └──┬────────────────────┘
                 │                          │
    ┌────────────▼──────────────────────────▼─────────────────┐
    │                   FIREBASE ADMIN SDK                      │
    │   lib/firebase/admin.ts                                   │
    ├────────────────────┬──────────────────┬──────────────────┤
    │  adminAuth         │  adminDb          │  adminStorage    │
    │  - verifyIdToken   │  - get()          │  - bucket()      │
    │  - createUser      │  - set()          │  - file().save() │
    │  - updateUser      │  - update()       │  - makePublic()  │
    │  - deleteUser      │  - add()          │                  │
    │  - getIdToken      │  - delete()       │                  │
    │  - setClaims       │  - query()        │                  │
    └────────────────────┴──────────────────┴──────────────────┘
              │                     │                   │
    ┌─────────▼──────┐   ┌──────────▼────────┐  ┌──────▼──────┐
    │ Firebase Auth  │   │    Firestore       │  │  Firebase   │
    │  (users/UIDs)  │   │  (all app data)    │  │   Storage   │
    └────────────────┘   └───────────────────┘  └─────────────┘
                                                        │
                                              ┌─────────▼──────────┐
                                              │     ZeptoMail       │
                                              │  lib/email/         │
                                              │  - system sender    │
                                              │  - request sender   │
                                              └────────────────────┘
```

---

## 10. `lib/` — Shared Logic

### `lib/auth/`
- **`auth-context.tsx`** — `AuthProvider` and `useAuth()` hook. Manages sign-in, sign-out, role resolution, and session caching.

### `lib/firebase/`
- **`client.ts`** — Browser Firebase app (`auth`, `db`). Used in React components and client hooks.
- **`admin.ts`** — Server Firebase Admin (`adminAuth`, `adminDb`, `adminStorage`). Used in API routes only. Import with `import "server-only"` already enforced.
- **`customer-client.ts`** — Separate Firebase client for the customer book-now side.

### `lib/email/` — transactional email (templates + send)

| File | Purpose |
|---|---|
| **`templates.ts`** | **Master HTML template** — `renderEmail()` layout (header, body, details table, highlight, login card, CTA, footer). Edit design here. |
| **`account-emails.ts`** | Welcome + reset **copy** — calls `renderEmail` then `sendEmail` for owners, customers, staff, password codes. |
| **`zeptomail.ts`** | ZeptoMail transport — `sendEmail()` only; reads `ZEPTOMAIL_*` env vars. |

Inspection update emails are **not** in `lib/email/`; their copy and `renderEmail()` calls live in **`lib/notifications/server.ts`** (`EMAIL_PRESENTATION`, `sendCustomerNotificationEmail`).

### `lib/business/`
- **`business-profile-context.tsx`** — React context that listens to `businesses/{id}` in real-time (Firestore `onSnapshot`). Provides `businessName`, `logoUrl`, `bookingSlug`.
- **`use-business-profile.ts`** — Hook that reads from the context above.

### `lib/onboarding/`
- **`types.ts`** — All business types, AU states, plans, onboarding payload shape.
- **`server.ts`** — `createTenantFromPayload()`, `registerSelfSignupTenant()`. Creates the Firestore business doc, Firebase Auth user, and sends welcome email.
- **`booking-slug.ts`** — Slugify + validate + reserve booking URLs.

### `lib/inspection/`
- **`types.ts`** — All inspection request statuses, types, and transitions.
- **`server.ts`** — Create/list/update inspection requests; triggers notifications.
- **`inspection-requests-context.tsx`** — React context with real-time Firestore listener for the owner's inspection board.
- **`use-inspection-requests.ts`** — Hook to access the context.

### `lib/customer/`
- **`types.ts`** — `CUSTOMER_COLLECTION`, profile types, email/phone validators.
- **`server.ts`** — Customer auth verification, profile CRUD, **`ensureCustomerAccount`** (owner Add Inspection), `DEFAULT_CUSTOMER_PASSWORD`.

### `lib/notifications/`
- **`server.ts`** — Create, list, mark-read, delete notifications in Firestore. Also triggers email notifications for relevant events.
- **`business-notifications-context.tsx`** — Real-time notification listener for business owners.
- **`customer-notifications-context.tsx`** — Real-time notification listener for customers.

### `lib/onboarding/services/`
- **`server.ts`** — Full CRUD for both `serviceTemplates` (super admin) and `services` (business owner), including embedded task management and image uploads.
- **`upload.ts`** — Firebase Storage helpers for logo and service images.

---

## 11. `components/` — UI Components

### Auth & Layout
| Component | Description |
|---|---|
| `providers.tsx` | Root providers: `AuthProvider`, `CustomerAuthProvider`, notification providers |
| `auth-guard.tsx` | Redirects unauthenticated users away from `/dashboard` |
| `business-owner-guard.tsx` | Blocks non-owners from owner-only pages |
| `login-form.tsx` | Email/password form with "Forgot password?" trigger |
| `forgot-password-modal.tsx` | 5-stage password reset flow (modal) |
| `login-redirect.tsx` | Redirects already-authenticated users away from `/login` |
| `dashboard-shell.tsx` | Main dashboard layout: fixed header, sidebar, content area |
| `sidebar.tsx` | Role-filtered nav; header uses static `/bms_pro_blue.jpeg` brand logo |
| `sign-out-confirm-modal.tsx` | Confirm dialog before sign-out |

### Dashboard Features
| Component | Description |
|---|---|
| `inspection-visits-board.tsx` | Inspection request board: filters, detail drawer, owner actions, **Add Inspection** + Refresh buttons |
| `add-inspection-modal.tsx` | 4-step owner modal (job → address → dates → contact); submits to `POST /api/inspection-requests` |
| `booking-slot-date-picker.tsx` | Shared calendar + morning/afternoon slot picker (booking engine + add-inspection modal) |
| `team-staff-form.tsx` | Staff list + add/edit; **Can get quotation** toggle (`canget_qutaion`); default password `00001111` on create |
| `tenants-table.tsx` | Super-admin tenant list + create modal |
| `business-logo-settings.tsx` | Logo upload on settings page |
| `booking-link-card.tsx` | Shows/copies the public booking URL |
| `business-notification-bell.tsx` | Dropdown notification bell for owners |

### Booking Engine (public)
| Component | Description |
|---|---|
| `booking-engine.tsx` | Public service selection + inspection request form |
| `customer-auth-modal.tsx` | Customer sign-in/sign-up modal |
| `customer-auth-gate.tsx` | Requires customer auth for protected views |
| `customer-account-nav.tsx` | Navigation for customer account tabs |

### Services & Templates
| Component | Description |
|---|---|
| `service-template-card.tsx` | Super-admin template card (read/edit) |
| `service-owner-card.tsx` | Business owner service card |
| `service-detail-drawer.tsx` | Side panel with full service details |
| `service-owner-wizard-steps.tsx` | Multi-step service creation wizard |
| `service-task-sortable-list.tsx` | Drag-to-reorder checklist tasks |

---

## 12. Dashboard Pages

| URL | Role | What it shows |
|---|---|---|
| `/dashboard` | All | Today: KPI cards, booking link, quick actions |
| `/dashboard/inspection-visits` | Owner | Inspection request board; **Add Inspection** opens 4-step modal; auto-creates customer + emails |
| `/dashboard/bookings` | Owner | Placeholder — links to inspection visits |
| `/dashboard/customers` | Owner | Customer list derived from inspection data |
| `/dashboard/team` | Owner | Staff list, add/edit, availability |
| `/dashboard/services` | Owner | Business services with wizard |
| `/dashboard/services` | Super admin | Global service templates |
| `/dashboard/tenants` | Super admin | Tenant list, create new tenant |
| `/dashboard/settings` | Owner | Booking link, logo, business settings |

The dashboard `layout.tsx` wraps all pages in:
1. `AuthGuard` — redirects if not logged in
2. `DashboardDataProviders` — loads `BusinessProfileProvider`, `InspectionRequestsProvider`, `BusinessNotificationsProvider`

---

## 13. Running the Project

### Install dependencies
```bash
npm install
```

### Set up environment
Copy the template above into `.env.local` and fill in all values.

### Run development server
```bash
npm run dev
```

App is available at `http://localhost:3000`.

### Build for production
```bash
npm run build
npm run start
```

### Lint
```bash
npm run lint
```

---

## 14. Scripts

### Seed the first super admin
```bash
npm run seed:super-admin
```

**File:** `scripts/seed-super-admin.ts`

This script:
1. Creates a Firebase Auth user with the given email/password
2. Writes a document to `super_admins/{uid}` with `{ isActive: true }`

Run this once after setting up a new Firebase project. Requires `FIREBASE_ADMIN_*` env vars.

### Deploy Firestore rules and indexes
```bash
npm run firebase:deploy-rules
```

Deploys `firestore.rules` and `firestore.indexes.json` to Firebase. Requires the Firebase CLI to be installed and authenticated.

---

## Architecture Overview

```
Browser
  ├── Admin users  ──→  /login → /dashboard/**
  └── Customers    ──→  /booknow/[slug]/**

Next.js App Router
  ├── app/  (pages + API routes)
  │     └── api/auth/…              Custom password reset (6-digit code)
  │     └── api/admin/…             Super-admin operations
  │     └── api/business/…          Owner profile + logo upload
  │     └── api/inspection-requests POST (owner Add Inspection) + GET + PATCH [id]
  │     └── api/booking/…           Public inspection request (by slug)
  │     └── api/team/staff          Staff CRUD (default password 00001111)
  │     └── api/notifications/…     Owner + customer notifications
  │     └── api/customer/…          Customer bookings + profile
  │
  ├── lib/
  │     ├── firebase/client.ts      → Firestore + Auth (browser)
  │     ├── firebase/admin.ts       → Firestore + Auth + Storage (server)
  │     ├── customer/server.ts      → ensureCustomerAccount (owner flow)
  │     ├── inspection/server.ts    → createInspectionRequest + owner actions
  │     ├── notifications/server.ts → in-app + customer inspection emails
  │     └── email/
  │           templates.ts          → renderEmail() HTML layout
  │           account-emails.ts     → welcome + reset senders
  │           zeptomail.ts            → ZeptoMail transport
  │
  └── components/
        add-inspection-modal.tsx    → owner 4-step wizard
        inspection-visits-board.tsx → board + Add Inspection button
        booking-engine.tsx            → public book-now flow
        forgot-password-modal.tsx     → admin reset UI

Firebase (Backend)
  ├── Authentication             User accounts (admin, staff, customer)
  ├── Firestore                  businesses, users, customers, inspection_requests, …
  └── Storage                    Logo + service images

ZeptoMail (Email)
  ├── system sender (noreply@)   Welcome, reset code, owner/staff/customer account
  └── request sender (request@)  Customer inspection status emails
```
