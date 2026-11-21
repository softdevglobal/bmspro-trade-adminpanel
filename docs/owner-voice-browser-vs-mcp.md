# Browser tools or MCP tools: what they are and when to use each

Sophie can manage **services**, the **team** and **AI knowledge drafts** for the owner in two ways.
Both are built for every action; this page explains what each way is, why both exist, and when
each one is the better choice.

How it is built: [owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md).
Feature guides: [owner-voice-services.md](owner-voice-services.md), [owner-voice-team.md](owner-voice-team.md).

---

## 1. What they are

### Browser tools — Sophie uses the owner's screen

Like an assistant sitting at the owner's computer. Sophie opens the Trade page, fills in the
form, scrolls to what she changed, and shows the confirm dialog. The owner watches it happen and
can press the buttons at any time.

- Runs in the owner's browser tab (Talk to Sophie panel + the Trade page).
- Uses the page's own popups and dialogs, which call the normal Trade API.
- Needs Trade open in a browser. Sophie navigates to the right page herself.

### MCP tools — Sophie asks the Trade server

Like phoning head office. Sophie sends a request to the Trade server; the server works out the
change, Sophie reads it back, and after the owner's "yes" the server applies it. Nothing appears
on screen.

- Runs on the Trade server (the owner MCP route).
- Calls the **same** Trade API code the pages use, so the rules are identical.
- Needs no page open, and can serve any channel that can sign in as the owner.

---

## 2. Every action, both ways

| Action | Browser tool | MCP tool |
|---|---|---|
| List services | `list_services` | `get_services` |
| List staff | `list_staff` | `get_staff` |
| List leave requests | `list_leave_requests` | `get_leave_requests` |
| Attendance | `show_attendance` | `get_attendance` |
| Approve / reject leave | `decide_leave_request` | `prepare_leave_decision` → `confirm_owner_change` |
| Suspend / reactivate staff | `manage_staff_member` | `prepare_staff_status` → `confirm_owner_change` |
| Add / edit staff | `open_staff_form` + `staff_form_step` | `prepare_staff_create` / `prepare_staff_update` → `confirm_owner_change` |
| Add / edit services | `open_add_service_form` / `open_edit_service_form` + `choose_service_source` (template or custom) + `service_form_step` | `prepare_service` → `create_service`, `prepare_service_update` → `confirm_owner_change` |
| List / add / edit customers | `list_customers`, `open_add_customer_form` / `open_edit_customer_form` + `customer_form_step` | `get_customers`, `prepare_customer_create` / `prepare_customer_update` → `confirm_owner_change` |
| Delete staff / service | `manage_staff_member` (delete), `delete_service` | `prepare_staff_delete` / `prepare_service_delete` → `confirm_owner_change` |
| Knowledge drafts | `prepare_knowledge_draft` → `save_knowledge_draft` | `prepare_knowledge_entry` → `confirm_owner_change` |
| Knowledge search (RAG answers) | `search_business_knowledge` | `search_business_knowledge` (the same tool) |
| List knowledge entries | `list_knowledge` | `get_knowledge_entries` |
| Edit a knowledge entry | `open_knowledge_entry` + `knowledge_form_step` (fill, review, save) | `prepare_knowledge_update` → `confirm_owner_change` |
| Publish / unpublish knowledge | `manage_knowledge_entry` (publish / unpublish → confirm) | `prepare_knowledge_publish` → `confirm_owner_change` |
| Delete knowledge | `manage_knowledge_entry` (delete → confirm) | `prepare_knowledge_delete` → `confirm_owner_change` |
| List items (Item list) | `list_items` | `get_items` |
| Add an item | `open_add_item_form` + `item_form_step` | `prepare_item_create` → `confirm_owner_change` |
| Edit an item | `open_edit_item_form` + `item_form_step` | `prepare_item_update` → `confirm_owner_change` |
| Delete an item | `delete_item` (prepare → confirm) | `prepare_item_delete` → `confirm_owner_change` |

Both ways need a read-back and a clear "yes" before anything changes. Item details:
[owner-voice-items.md](owner-voice-items.md).

---

## 3. Why have both

| | Browser tools | MCP tools |
|---|---|---|
| The owner **sees** the change | Yes | No, only hears it |
| Catches misheard emails, numbers, names | Yes, on screen before saving | Only if the owner listens closely |
| Needs Trade open in a browser | Yes | No |
| Works without a screen | No | Yes |
| Screen jumps to another page | Yes, Sophie navigates | No |
| Speed for a quick question | Slower (page must load) | Faster |
| Extras | Scrolls and outlines changes, attendance export | — |

Neither is better everywhere. Browser tools are **safer**; MCP tools are **more flexible**.

---

## 4. When each one is useful

### Use browser tools when the owner is at the screen and accuracy matters

| Situation | Why browser |
|---|---|
| Adding or editing a staff member | The email and mobile must be exactly right: the invitation email goes out on save and cannot be recalled. On screen the owner sees the typed address. |
| Adding or editing a service | Name, duration, Live switch and up to 12 steps are easy to check at a glance, hard to follow when read aloud. |
| Deleting a staff member or a service | It cannot be undone. The dialog shows the exact name with Yes / No buttons. |
| Saving a knowledge draft | The note (and any warnings) is shown exactly as it will be saved; a wrong price would later be told to callers. |
| A new owner learning Trade | They see where things live and how Sophie fills them in. |

### Use MCP tools when there is no screen, or seeing it adds nothing

| Situation | Why MCP |
|---|---|
| Quick questions: "How many staff?", "Any leave requests?", "Hours this week?" | Read-only; no need to open pages or move the screen. |
| Approving or rejecting leave | A yes/no about one named person and dates; the read-back includes every clash and who covers it. |
| Suspending or reactivating a staff member | One person, one switch, and it can be reversed at once. |
| The owner is busy on another Trade page | Sophie can answer or act without taking the screen away. |
| A slow connection or a small phone screen | No page loads; only short requests to the server. |
| A future channel without a screen (e.g. an owner phoning in) | Browser tools cannot run there at all. This needs owner sign-in for that channel first (not built yet). |
| Automated tests and other systems | Plain server calls are easy to test and reuse. |

### Rule of thumb

> **Typed details** (emails, phone numbers, long lists) or **cannot be undone** → browser.
> **Read-only**, or a **short decision that can be reversed** → MCP.

---

## 5. Recommended split (hybrid)

Using the rule of thumb per action:

| Action | Recommended | Why |
|---|---|---|
| Lists: services, staff, leave requests, attendance | MCP | Read-only and faster; the screen does not jump for a simple question |
| Approve / reject leave | MCP | Simple decision; the read-back includes the clashes |
| Suspend / reactivate staff | MCP | Simple and easy to undo |
| Add / edit staff | Browser | Contact details must be seen; the invitation email cannot be undone |
| Add / edit services | Browser | Steps, duration and the Live switch are easier to check on screen |
| Delete staff or a service | Browser | Cannot be undone; the dialog should be on screen |
| Knowledge drafts | Browser | The note is shown on the AI knowledge page before saving |
| List knowledge entries | MCP | Read-only |
| Edit knowledge | Browser | The changed text is shown in the page's editor before saving |
| Publish / unpublish knowledge | MCP | One entry, one switch, reversible; the read-back includes the text callers will hear |
| Delete knowledge | Browser | Cannot be undone; the entry stays highlighted on the page until confirmed |
| List items / prices | MCP | Read-only |
| Add / edit items | Browser | A misheard price goes straight into quotations; the owner sees it in the form |
| Delete items | Browser | Cannot be undone; the dialog is on screen |

---

## 6. How to choose today

One setting in Trade `.env.local` decides what Talk to Sophie is offered:

```
AI_OWNER_VOICE_TOOL_MODE=browser   # all browser tools (default)
AI_OWNER_VOICE_TOOL_MODE=mcp       # all MCP tools
```

Restart `next dev` and start a new session after changing it.

The recommended **hybrid** split in §5 is not a mode yet. It needs no new tools — only a third
value (`hybrid`) that offers the browser tool for some actions and the MCP tool for the others.

Sophie is never offered both tools for the same action in one session: she could pick the wrong
one, and a "yes" meant for one could be mixed up with the other.

---

## 7. When each tool works

A tool only works when **all** of its conditions are met. If one is missing, Sophie is not offered
the tool (or it answers `NOT_OPEN` / `UNAVAILABLE`) and she says she could not do it.

### Conditions for every tool

| Condition | Why |
|---|---|
| The owner is signed in to Trade as the **business owner**, with Sophie Talk enabled for the business | Every tool acts as that owner; staff and admins cannot use Talk to Sophie |
| A **Talk to Sophie** session is open (voice or chat) | Sessions end after 10 minutes or when the owner ends them |
| The voice bridge is running and knows the tool name | Otherwise the session does not start (`POST /api/ai/owner-call 502`) |
| The area's flag is on (table below) | Each area can be switched off on its own |

### Which tools are offered

| Area | Flag (Trade `.env.local`) | `AI_OWNER_VOICE_TOOL_MODE=browser` (default) | `AI_OWNER_VOICE_TOOL_MODE=mcp` |
|---|---|---|---|
| Services | `AI_OWNER_VOICE_SERVICE_ENABLED=true` | `list_services`, `open_add_service_form`, `choose_service_source`, `open_edit_service_form`, `service_form_step`, `delete_service` + `prepare_service` / `create_service` | `get_services`, `prepare_service` / `create_service`, `prepare_service_update`, `prepare_service_delete` |
| Team | `AI_OWNER_VOICE_TEAM_ENABLED=true` | `list_staff`, `open_staff_form`, `staff_form_step`, `manage_staff_member`, `list_leave_requests`, `decide_leave_request`, `show_attendance` | `get_staff`, `prepare_staff_create`, `prepare_staff_update`, `prepare_staff_status`, `prepare_staff_delete`, `get_leave_requests`, `prepare_leave_decision`, `get_attendance` |
| AI knowledge (write) | `AI_OWNER_VOICE_KNOWLEDGE_WRITE_ENABLED=true` | `prepare_knowledge_draft`, `save_knowledge_draft`, `discard_knowledge_draft`, `list_knowledge`, `open_knowledge_entry`, `knowledge_form_step`, `manage_knowledge_entry` | `get_knowledge_entries`, `prepare_knowledge_entry`, `prepare_knowledge_update`, `prepare_knowledge_publish`, `prepare_knowledge_delete` |
| AI knowledge (search) | `AI_OWNER_VOICE_KNOWLEDGE_ENABLED=true` and `AI_VOICE_KNOWLEDGE_ENABLED=true` | `search_business_knowledge` | `search_business_knowledge` |
| Item list | `AI_OWNER_VOICE_ITEMS_ENABLED=true` | `list_items`, `open_add_item_form`, `open_edit_item_form`, `item_form_step`, `delete_item` | `get_items`, `prepare_item_create`, `prepare_item_update`, `prepare_item_delete` |
| Any MCP change | (any area above on, in mcp mode) | — | `confirm_owner_change`, `cancel_owner_change` |

### Extra conditions for browser tools

| Condition | Details |
|---|---|
| Trade is open in the owner's browser tab | The tools run in that tab. Closing or reloading the tab ends them. |
| The page can load | Sophie opens it herself (Services, Team → Management / Leave requests / Attendance, AI knowledge) and waits up to 8–15 s for its list to load; otherwise `NOT_OPEN`. |
| A popup or dialog is open for form actions | `service_form_step`, `staff_form_step` and `knowledge_form_step` need their popup or editor open first (Sophie opens it with the `open_*` tool). |
| Typed entries only for knowledge editing | Imported files, web pages and entries built from settings are edited by hand. |

Read-only list tools (`list_services`, `list_staff`, `list_leave_requests`, `list_knowledge`) read
the API directly and work from any Trade page.

### Extra conditions for MCP tools

| Condition | Details |
|---|---|
| The Trade server is reachable | No page needs to be open; the owner can be on any Trade page. |
| The owner's login is valid | Each MCP call sends the owner's login; an expired login ends the session. |
| A pending change exists for `confirm_owner_change` | Prepared in this business by this owner, **at least 5 seconds and at most 30 minutes** ago, not cancelled or replaced. |
| Under the change limit | 30 confirmed changes per owner per hour (plus each API's own limits). |
| Other channels (e.g. phone) | Need their own way to sign in as the owner first — not built yet. |

### Changes need a "yes" in both modes

A change only goes through after Sophie's read-back **and** the owner's reply that does not say
no / wait / cancel. A change made after the read-back needs a new read-back.

---

## 8. Same in both

- The read-back and a clear "yes" before any change.
- Business and user come from the owner's login, never from what Sophie sends.
- The same Trade API rules: plan staff limit, duplicate email and phone checks, invitation emails,
  leave clash and reassignment rules, knowledge screening, and the audit log.
- Owner briefings, knowledge search, and photo uploads (by hand only) do not change between modes.

---

## 9. Complete list of every tool

Every tool name Sophie can be offered. The voice bridge keeps the same list
(`src/agents/trade/trade-owner-voice.mjs`, `toolNames`); a tool missing there makes the session fail
to start (`Sophie could not start a session through the voice bridge`), so **restart the bridge
after adding a tool**.

### 9.1 Read-only briefing tools (MCP, always offered)

Run on the Trade owner MCP route. They never change anything and are not part of
`AI_OWNER_VOICE_TOOL_MODE`.

| Tool | What it does |
|---|---|
| `get_daily_summary` | A day's schedule: jobs and inspections by status, visit times, unassigned visits |
| `get_day_activity` | What was done across the business on a day: jobs, inspections, quotes, invoices, payments |
| `get_staff_day_report` | What each staff member did on a day: clock-in/out, hours, jobs, leave |
| `get_staff_working_today` | Staff off days, approved leave, check-ins and assignments right now |
| `get_sophie_call_summaries` | Summaries of saved Sophie calls with verified outcomes |
| `get_customer_call_history` | Saved Sophie conversations by customer name or phone |
| `lookup_customer_jobs` | A customer's history, or a record by job, quote or invoice reference |
| `suggest_scheduling` | Available staff and visit times (never a reservation) |
| `list_quote_follow_ups` | Sent quotes awaiting a customer decision |
| `list_jobs_awaiting_scheduling` | Accepted jobs waiting to be scheduled |
| `list_invoices` | Invoices in any status, by reference or customer |
| `list_overdue_invoices` | Overdue invoices, unpaid balances and reminder-call outcomes |
| `list_missed_calls` | Missed calls, callback outcomes and retry status (`followUp=true` to call back) |
| `search_business_knowledge` | Answers from the AI knowledge base (also listed in §7) |

### 9.2 Browser tools (run in the owner's tab)

| Area | Tools |
|---|---|
| Services | `list_services`, `open_add_service_form`, `open_edit_service_form`, `choose_service_source`, `service_form_step`, `delete_service` |
| Team | `list_staff`, `open_staff_form`, `staff_form_step`, `manage_staff_member`, `list_leave_requests`, `decide_leave_request`, `show_attendance` |
| Customers | `list_customers`, `open_add_customer_form`, `open_edit_customer_form`, `customer_form_step` |
| AI knowledge | `prepare_knowledge_draft`, `save_knowledge_draft`, `discard_knowledge_draft`, `list_knowledge`, `open_knowledge_entry`, `knowledge_form_step`, `manage_knowledge_entry` |

`service_form_step` takes an `action`:

| Action | What it does in the Add / Edit service popup |
|---|---|
| `fill` | Types the name, duration (15-720 min) and steps into the form; goes nowhere |
| `continue` | Next step (checks the step first; `INVALID` says what is missing) |
| `back` | Previous step |
| `save` | Saves. Only on the review step, and only after the read-back and a clear "yes" |

`choose_service_source` (Add only): `template` (optionally with `templateName`) or `custom`.

### 9.3 MCP tools that change things (server-side, read back + "yes")

| Area | Tools |
|---|---|
| Services | `prepare_service`, `create_service`, `prepare_service_update`, `prepare_service_delete` |
| Team | `get_staff`, `prepare_staff_create`, `prepare_staff_update`, `prepare_staff_status`, `prepare_staff_delete`, `get_leave_requests`, `prepare_leave_decision`, `get_attendance` |
| AI knowledge | `get_knowledge_entries`, `prepare_knowledge_entry`, `prepare_knowledge_update`, `prepare_knowledge_publish`, `prepare_knowledge_delete` |
| Customers | `get_customers`, `prepare_customer_create`, `prepare_customer_update` |
| Confirm | `confirm_owner_change`, `cancel_owner_change` |
| Services (read) | `get_services` |

`prepare_service` / `create_service` are offered in both modes.
