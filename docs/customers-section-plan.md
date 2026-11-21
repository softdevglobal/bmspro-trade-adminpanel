# Customers section: add, import and voice plan

**Status:** phases 1 to 3 are **built** (Add / Edit popup, voice browser tools, MCP tools). Not yet
built: the booking-portal invite action (phase 4) and the deferred import. Decisions taken while
building, since the open questions were not answered: an email is required (the account is keyed by
email); an existing email or phone is **never** added twice (the existing customer is shown
instead); add and edit are available to the owner and admins (`requireBusinessOwner`).

### What was built

| Piece | Where |
|---|---|
| Shared rules (validation, duplicate rule, `trade:customers-changed` event) | `lib/customer/form.ts` |
| Create / update with duplicate check, audit log, channel (`manual`, `voice`, `mcp`) | `lib/customer/manage.ts` |
| API: `POST /api/customers`, `PATCH /api/customers/[id]` (the email cannot change) | `app/api/customers/` |
| Add / Edit customer popup (2 steps) | `components/customer-form-modal.tsx` |
| Add button, Edit button in the preview, reload on change | `components/customers-board.tsx` |
| Voice browser tools: `list_customers`, `open_add_customer_form`, `open_edit_customer_form`, `customer_form_step` | `lib/ai/owner-call/owner-customer.ts`, `owner-customer-runner.ts`, `components/owner-voice-session.tsx` |
| MCP tools: `get_customers`, `prepare_customer_create`, `prepare_customer_update` (applied by `confirm_owner_change`) | `lib/ai/owner-call/owner-actions.ts`, `lib/ai/mcp/tools/owner-actions.tools.ts` |
| Voice bridge allow-list | `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` |
| Flag | `AI_OWNER_VOICE_CUSTOMERS_ENABLED=true` |
| Tests | `npm run test:customer-form`, bridge `tests/owner-voice.test.mjs` |

**To use it:** set the flag, restart `next dev`, **restart the voice bridge** (it reads its tool
allow-list at startup), then start a new Talk to Sophie session. No instruction line was added to
Sophie's prompt (it is at the 4,000-character cap); the tool descriptions carry the guidance.
**Goal (now):** the owner can add or edit a single customer by hand, by voice (Talk to Sophie) or
through MCP tools.

> **Deferred, not building now:** bulk **Import customers** (CSV, Excel, other platform exports,
> contacts files, PDF / Word, email, web page, pasted list). The plan for it is kept in this file
> as HTML comments (§4 and the marked parts below) for later.

Related: [owner-voice-browser-vs-mcp.md](owner-voice-browser-vs-mcp.md) (how browser and MCP tools
work), [owner-voice-services.md](owner-voice-services.md) (the same pattern for services).

---

## 1. What exists today

| Piece | Where | What it does now |
|---|---|---|
| Customers page | `app/dashboard/customers/page.tsx` → `components/customers-board.tsx` | Read-only list with search. Built from registered customers plus requests, quotes, jobs and invoices. **No Add, Edit or Import button.** |
| Customers API | `app/api/customers/route.ts` | `GET` only (list). |
| Customer record | `customers/{uid}` + a Firebase Auth user, see `lib/customer/types.ts` | `fullName`, `email`, `phone`, `registeredBusinessId`, booking slug. One login per business per email. |
| Create helper | `ensureCustomerAccount()` in `lib/customer/server.ts` | Creates the account if the email is new for this business, optional welcome email, `preserveExistingProfile` for voice. |
| CSV import | Settings → data import (`components/business-data-export-settings.tsx`, `app/api/business/data-import`, `lib/export/import-*.ts`) | Dataset `customers` with headers **Customer, Email, Phone** only. **Max 100 rows.** No welcome email. Audit log per created customer. |
| File and web readers | `lib/ai/rag/loaders/` (`file-loaders.ts`, `website-loader.ts`, `xlsx-reader.ts`) | Already read PDF, DOCX, XLSX, PPTX and public web pages (with SSRF checks) for AI knowledge import. Max 25 MB. |
| Signed uploads | AI knowledge import (`app/api/ai/knowledge/import`) | Upload to Storage with a signed link, claim once, delete the file after reading. |
| Email | `app/api/email/*`, `lib/email-integration/mailbox/directory.ts` | Owners connect a mailbox (OAuth); the mailbox already knows customer contacts. |
| Phone Sophie | `lib/ai/mcp/tools/customer.tools.ts` (`register_customer`) | Callers can be registered on a call, with consent and read-back. |
| Owner voice | `lib/ai/owner-call/*`, `components/owner-voice-session.tsx` | Browser and MCP tools for services, team and knowledge. **None for customers.** |

---

## 2. Customer record changes

Today a customer needs a name, email and phone. Old-platform exports are messier, so:

| Field | Required | Notes |
|---|---|---|
| `fullName` | Yes | Or first name + last name, joined on import |
| `email` | **See open question 1** | The account is keyed by email today |
| `phone` | One of email or phone | Normalised to AU format (`lib/phone/au-phone.ts`) |
| `address` | No | New. Same shape as `InspectionAddress` so jobs can reuse it |
| `company` | No | New. Business customers (strata, property managers) |
| `notes` | No | New. Short, owner-only, never read to callers |
| `source` | Auto | New. `manual`, `csv`, `excel`, `pdf`, `word`, `email`, `website`, `paste`, `voice`, `mcp`, plus `importId` |
| `invitedAt` | Auto | New. Set only when the owner sends an invite |

**Duplicates:** match on email (case-insensitive) first, then on normalised phone, within this
business only. A duplicate is **skipped** by default; the owner can choose **fill empty fields**
(never overwrite what is already there).

**No emails on import.** Imported customers are never emailed automatically (Spam Act; the owner
may not have consent). A separate **Invite to booking portal** action sends the welcome email to
chosen customers later.

---

## 3. Add customer popup (manual)

A new **Add customer** button on the Customers page header, next to search.

**Popup steps** (same look as the Add service wizard):

1. **Details:** name, email, mobile, address (optional, with the existing address autocomplete), company, notes.
2. **Review:** shows the record and any duplicate found ("Nira Jay already exists with this email:
   open it instead?"). Checkbox **Send an invite email now** (default off).

**Edit:** each customer row and the preview drawer get an **Edit** button that opens the same
popup with the record loaded. Changing the email of a customer who has logged in is blocked (it is
their login); the owner is told to ask the customer.

**API**

| Route | Method | Who | What |
|---|---|---|---|
| `/api/customers` | `POST` | Owner (and admin staff if allowed, see open question 3) | Create one customer via `ensureCustomerAccount` (`sendWelcomeEmail` from the checkbox) |
| `/api/customers/[id]` | `PATCH` | Same | Edit name, phone, address, company, notes |
| `/api/customers/check` | `POST` | Same | Duplicate check for the review step |

All write an audit event (`customer.created` / `customer.updated`, `metadata.via`).

---

## 4. Import customers popup (deferred, not building now)

<!-- DEFERRED: Import customers. Not in scope for now; kept for a later phase.

A second header button, **Import customers**, opens one wizard for every source.

### Step 1: choose where the customers are

| Source | How the owner gives it | How we read it |
|---|---|---|
| **CSV** | Upload a `.csv` export | Parse rows, map columns (step 2) |
| **Excel** | Upload `.xlsx` | Existing `xlsx-reader.ts`, then the same as CSV |
| **Other platform export** | Pick the platform, upload its export | A saved column preset per platform (see below), then the same as CSV |
| **Phone or email contacts** | Upload `.vcf` (vCard) or a Google / Outlook contacts CSV | vCard parser; contacts CSV uses a preset |
| **PDF or Word** | Upload `.pdf` / `.docx` (a printed customer list, an invoice run) | Existing `file-loaders.ts` → text → AI extraction (below) |
| **Email** | (a) Connected mailbox: "people who emailed me in the last N months"; (b) paste an email or signature | (a) Mailbox directory; (b) AI extraction |
| **Web page** | A public URL (for example an old portal's public customer list) | Existing `website-loader.ts` (SSRF safe) → AI extraction. Pages behind a login cannot be read; the wizard tells the owner to export a file instead |
| **Paste a list** | Paste text (from a spreadsheet, a notes app, a message) | Tab/comma detection first, AI extraction if it is free text |

**Platform presets** (first set, to confirm against real exports before building): ServiceM8,
Tradify, Fergus, simPRO, Xero contacts, MYOB, Google Contacts, Outlook contacts. A preset is only a
column map; any unknown export still works through manual mapping.

### Step 2: match the columns (CSV, Excel, presets)

- Auto-match headers like *Name, Full name, Customer, Contact, First name + Last name, Email,
  E-mail, Mobile, Phone, Address, Street, Suburb, Postcode, Company*.
- The owner can change any match or set a column to *Ignore*.
- Skipped for AI-extracted sources (they arrive already as fields).

### AI extraction (PDF, Word, email, web page, free text)

- The extracted text is sent to the model with a strict JSON schema: `{ fullName, email, phone,
  address, company }[]`. Nothing else.
- Every AI row is marked **Check** in the preview; the owner must review before import.
- Scanned (image-only) PDFs are not supported, the same as AI knowledge today.
- The text is not stored after the import; only the created customers are.

### Step 3: preview

A table of every row with a status:

| Status | Meaning | Default |
|---|---|---|
| New | Will be created | Ticked |
| Duplicate | Matches an existing customer (shows which) | Unticked (skip) or *fill empty fields* |
| Duplicate in file | Same email or phone twice in this import | First one kept |
| Needs fixing | Missing name, or no email and no phone, or invalid email | Unticked, editable in place |
| Check | Came from AI extraction | Ticked, highlighted |

Counts at the top: *142 new · 6 duplicates · 3 need fixing*. The owner can edit cells, untick rows,
and download the problem rows as CSV.

### Step 4: import and result

- **Import 142 customers.** Runs as a background job for big files with a progress bar, so the
  owner can close the popup.
- Result: created, skipped, failed (with reasons) and a link to **Undo this import** (deletes
  customers created by this `importId` that have no requests, jobs, quotes or invoices yet,
  available for 7 days).
- One audit event for the whole import (`customer.imported`, counts and source), plus the existing
  per-customer `customer.created`.

### Limits

| Limit | Value | Why |
|---|---|---|
| Rows per import | 5,000 (from 100 today) | Real customer lists; done in batches of 200 |
| File size | 25 MB | Same as AI knowledge |
| Imports | 10 per business per hour | Abuse and cost (AI extraction) |
| AI extraction | 2,000 rows per file | Model cost and accuracy |

### Import API

| Route | What |
|---|---|
| `POST /api/customers/import/upload` | Signed upload link (same pattern as knowledge import). **The Storage bucket CORS must list every app origin, or uploads fail.** |
| `POST /api/customers/import/parse` | `{ uploadId \| url \| text \| mailbox, source, preset? }` → `importId` + rows with statuses. Deletes the uploaded file after reading |
| `PATCH /api/customers/import/[importId]` | Save the owner's edits, mapping, ticks |
| `POST /api/customers/import/[importId]/run` | Start the import (background) |
| `GET /api/customers/import/[importId]` | Progress and result |
| `POST /api/customers/import/[importId]/undo` | Undo within 7 days |

Pending imports are stored in `customer_imports/{importId}` (business-scoped, deleted after 7 days).

END DEFERRED: Import customers -->

---

## 5. Talk to Sophie: voice and MCP tools

Flag: `AI_OWNER_VOICE_CUSTOMERS_ENABLED=true`. Like services and team, `AI_OWNER_VOICE_TOOL_MODE`
decides whether Sophie gets the browser tools or the MCP tools; never both for the same action.

### 5.1 Browser tools (Sophie uses the owner's screen)

| Tool | What it does |
|---|---|
| `list_customers` | Search customers by name, email or phone (read-only) |
| `open_add_customer_form` | Go to Customers and open the **Add customer** popup |
| `open_edit_customer_form` | Open the **Edit** popup for a named customer (asks which one if several match) |
| `customer_form_step` | `fill` (name, email, phone, address, company, notes), `continue`, `back`, `save` |

<!-- DEFERRED (import):
| `open_import_customers` | Open the **Import customers** popup, optionally on a source (`csv`, `excel`, `platform`, `pdf`, `email`, `website`, `paste`) |
| `import_customers_step` | `choose_source`, `set_platform`, `set_url`, `set_text`, `use_mailbox`, `summary` (reads the preview counts), `fix_row`, `skip_duplicates` / `fill_empty`, `run` |
- Files are chosen by the owner. A browser tool cannot pick a file from the owner's computer.
  Sophie opens the import, says "Choose your file now", and waits for the preview.
- For an import Sophie reads the counts ("142 new, 6 already in Trade, 3 need fixing"), never every row.
- `run` only after a clear "yes".
-->

Rules:
- **Read-back:** Sophie reads the name and phone and **spells the email**.
- `save` only after a clear "yes", with the same browser gate as `service_form_step`
  (`checkOwnerReply`).

Voice flow, add one customer:
> Owner: "Add a customer." → `open_add_customer_form` → Sophie asks name, mobile, email one at a
> time → `fill` → `continue` → reads back, spells the email → "Should I save this customer?" → `save`.

<!-- DEFERRED (import): voice flow
Owner: "Bring my customers over from ServiceM8." → `open_import_customers` (`platform`) →
`set_platform` → "Choose your ServiceM8 export file now." → preview → `summary` → reads counts →
"Should I import the 142 new customers?" → `run`.
-->

### 5.2 MCP tools (server only, nothing on screen)

Same two-step pattern as the other owner MCP tools (`prepare_*` stores one pending change,
`confirm_owner_change` applies it after the read-back, `cancel_owner_change` drops it).

| Tool | What it does |
|---|---|
| `get_customers` | Search customers (read-only) |
| `prepare_customer_create` | Store a new customer (name, email, phone, optional address, company, notes). Returns duplicates if any |
| `prepare_customer_update` | Store a change to one customer |
| `confirm_owner_change` | Existing. Now also applies customer changes |
| `cancel_owner_change` | Existing |

<!-- DEFERRED (import):
| `prepare_customer_import` | Parse a source the server can reach (`text`, `url`, `mailbox`, or an `importId` the owner already uploaded on screen) and store the import with its counts |
MCP cannot receive a file, so file imports by MCP start from an `importId` the owner uploaded in
the browser.
-->

### 5.3 Wiring checklist (lessons from services)

1. Add every new tool name to the bridge allow-list
   (`bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs`) and **restart the bridge**, or
   every session fails with *"Sophie could not start a session through the voice bridge."*
2. Sophie's instructions are capped at **4,000 characters** and are already near the cap. Add at
   most one short line ("For customers use the customer tools and follow their instructions.");
   put all detail in the tool descriptions.
3. Browser tools are handled in `components/owner-voice-session.tsx`; the popups register a
   handler the same way the Services wizard does (`registerServiceStepHandler`).
4. Fire a `trade:customers-changed` event after a save so an open Customers page reloads.
5. Update [owner-voice-browser-vs-mcp.md](owner-voice-browser-vs-mcp.md) §2, §7 and §9.

---

## 6. Security and privacy

- Business comes from the owner's login, never from the file, the model or Sophie.
- Add and edit are owner-only at first (open question 3).
- Customer data is personal information (Australian Privacy Principles). No marketing emails;
  invites are opt-in per customer.
- Audit log for every create and update.

<!-- DEFERRED (import):
- The import wizard asks the owner to confirm they hold these contacts lawfully.
- Uploaded files are deleted after parsing; extracted text is not kept.
- Only the fields we need are sent to the model.
- Formula injection: CSV cells starting with `=`, `+`, `-`, `@` are stored as plain text and escaped on export.
- Rate limits as in §4; audit log for every import and undo.
-->

---

## 7. Build order

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Record fields (§2), `POST` / `PATCH` / check APIs, **Add / Edit customer popup** | — |
| 2 | Voice **browser tools** for add / edit | 1 |
| 3 | **MCP tools** for add / edit | 1 |
| 4 | Invite to booking portal (opt-in) | 1 |

<!-- DEFERRED (import) phases, after the above:
| Import wizard with CSV and Excel, column mapping, preview, background run, undo, 5,000 rows |
| Platform presets and vCard / contacts files |
| PDF, Word, paste and web page with AI extraction |
| Email: connected mailbox contacts and pasted emails |
| Voice and MCP import tools |
Move the existing Settings CSV import onto the new import code, so there is one importer.
-->

---

## 8. Tests

- Unit: phone normalising, duplicate rules.
- API: owner-only access, business scoping, blocked email change for customers who have logged in.
- Voice: `customer_form_step` gate (no save without a reply after the read-back), bridge allow-list
  test updated with the new names.

<!-- DEFERRED (import) tests:
- Unit: header auto-match, presets, AI JSON validation, formula escaping.
- API: import limits, undo only for untouched customers.
- Voice: `import_customers_step` gate.
- Manual: a real export from each preset platform, a 5,000-row CSV, a scanned PDF (clear error), a
  login-only URL (clear error).
-->

---

## 9. Open questions

1. **Customers without an email.** Accounts are keyed by email today. Allow phone-only customers
   (no login until an email is added)?
2. **Duplicates:** when the owner adds a customer whose email or phone already exists, open the
   existing one (proposed), or allow a second record?
3. **Who can add and edit:** owner only, or admin staff too?

<!-- DEFERRED (import) questions:
- Which platforms first for presets? (ServiceM8, Tradify, Fergus, simPRO, Xero, MYOB proposed.)
- Bring history too? Old jobs, quotes and invoices could use the same wizard.
- Row limit: is 5,000 per import enough?
- Import duplicates: skip, or fill empty fields?
-->
