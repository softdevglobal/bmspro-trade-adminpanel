# Talk to Sophie: managing the team by voice

The business owner can manage the **Team** section by talking to Sophie (dashboard → **Talk to
Sophie**, voice or chat mode): staff members, leave requests and attendance. Sophie drives the
real Team pages on the owner's screen — the same popups, dialogs, buttons and owner APIs the
owner uses by hand — and never changes anything without a read-back and a clear "yes".

Built the same way as voice services; read [owner-voice-services.md](owner-voice-services.md)
first for the shared design (browser tools, confirmation gates, the bridge allow-list).

Turned on by `AI_OWNER_VOICE_TEAM_ENABLED=true`. Off by default.

> **Two ways.** This page describes the **browser tools** (Sophie drives the Team pages). Every
> team action also exists as an **MCP tool** that runs on the Trade server (`get_staff`,
> `prepare_staff_create`, `prepare_staff_update`, `prepare_staff_status`, `prepare_staff_delete`,
> `get_leave_requests`, `prepare_leave_decision`, `get_attendance` → `confirm_owner_change`).
> `AI_OWNER_VOICE_TOOL_MODE` picks which set Talk to Sophie uses. See
> [owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md).

---

## 1. What the owner can say

### Team management (`/dashboard/team/management`)

| Owner says | What happens |
|---|---|
| "Who is on my team?" / "How many staff do I have?" | Names, roles, active/suspended, working days, can quote, number of services, plan limit. No phone numbers or emails are read out. |
| "Add a staff member" | Opens **Setup staff member** (step 1 Details). Refused if the plan's staff limit is reached. |
| "Jordan Smith, 0412 345 678, jordan@…" | Types name, mobile and email. Sophie spells the email back. |
| "They can do quotes" / "No quotes" | Flips the **Quotation** switch. |
| "Role is plumber" | Types the role (step 2). |
| "Works Monday to Friday" / "Saturday off" | Sets the weekly schedule. |
| "Add Gutter cleaning, remove Roof repair" | Ticks / unticks services they can perform. |
| "Show me the schedule" / "Scroll down" | Scrolls to that section / scrolls. |
| "Continue" / "Back" | Next / previous step; Sophie says what is missing. |
| "Save" (after the read-back, with a clear yes) | Saves. A new staff member gets an invitation email. |
| "Edit Jordan" | Opens **Edit staff member** for Jordan. |
| "Suspend Jordan" / "Reactivate Jordan" | Opens the confirm dialog; changes only after a clear yes. |
| "Delete Jordan" | Opens **Delete staff member?**; deletes only after a clear yes. |

### Leave requests (`/dashboard/team/leave-requests`)

| Owner says | What happens |
|---|---|
| "Any leave requests?" / "Show approved leave" | Lists requests (pending by default) with dates, hours and the staff member's reason, plus counts. The page filter follows. |
| "Approve Sam's leave" | Opens **Approve leave for Sam?**, checks the schedule, and reads out every clashing job or visit, numbered, with who covers it (the owner by default). |
| "Give job 2 to Alex" / "I'll take number 1" | Changes who covers that clash, then reads it back again. |
| "Yes, approve it" | Approves (and reassigns the clashing work). |
| "Reject Sam's leave, we're short that week" | Opens **Decline this request?** with the reason filled in; rejects only after a clear yes. Sam sees the reason in the app. |
| "Sam's leave starting the 3rd" | When someone has several pending requests, Sophie asks which one by start date. |

### Attendance (`/dashboard/team/attendance`) — read only

| Owner says | What happens |
|---|---|
| "Show attendance this week" / "…for March" / "…yesterday" | Sets period and date; reports per person: days worked, hours, breaks, still checked in. |
| "Just Jordan and Sam" / "Everyone" | Sets the staff filter. |
| "Show staff totals" / "Detail sheet" / "All records" | Switches the view. |
| "Export that as PDF" / "…as a spreadsheet" | Downloads the current view (PDF, or CSV for "Excel"). |

Owners cannot clock staff in or out (staff do that in the mobile app), so attendance by voice is
read only. For "who is working today" or "what did Jordan do yesterday", Sophie keeps using the
existing server tools `get_staff_working_today` and `get_staff_day_report`.

**Not possible by voice:** uploading a staff photo (browsers only open the file picker on the
owner's own click) and viewing leave attachments (the owner taps them).

---

## 2. How it works

In browser mode every team tool runs in the browser (the MCP versions are described in
[owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md)):

```
Sophie (OpenAI Realtime) ── function_call ──► owner-voice-session.tsx
                                               └─ isOwnerTeamTool → runOwnerTeamTool (owner-team-runner.ts)
                                                    ├─ reads:   GET /api/team/staff, GET /api/leave-requests
                                                    └─ actions: navigate to the Team page, then call the handler
                                                                that page registered (owner-team.ts slots)
                                                                └─ the page uses its own popup / dialog / API:
                                                                   POST/PATCH/DELETE /api/team/staff
                                                                   PATCH /api/leave-requests/:id
                                                                   GET  /api/team/attendance
```

- **Page slots.** Each page registers what Sophie may do while it is open
  (`staffPageVoice`, `staffFormVoice`, `leavePageVoice`, `leaveApprovalVoice`,
  `attendancePageVoice`). A call right after navigating waits up to 8–15 s for the page and its
  data to load.
- **Same rules as the UI.** Saving, suspending, deleting, approving and rejecting go through the
  page's own functions, so the API's checks (owner login, plan staff limit, leave conflicts,
  reassignment rules, audit log) all apply.
- **Matching names.** "Jordan" finds "Jordan Smith"; several matches or none return the names for
  Sophie to read out and ask (`matchByName`).

---

## 3. The tools

| Tool | Arguments | What it does |
|---|---|---|
| `list_staff` | — | Read only. Team list and totals (first 50). |
| `open_staff_form` | `staffName?` | Without a name: Add staff. With a name: Edit that person. |
| `staff_form_step` | `action` + fields | Drives the open staff popup (below). |
| `manage_staff_member` | `action`: suspend, reactivate, delete, confirm, cancel · `staffName` | Opens the page's confirm dialog; `confirm` acts after a clear yes. |
| `list_leave_requests` | `status?`: pending (default), approved, rejected, all | Read only. Requests and counts (first 30). |
| `decide_leave_request` | `action`: approve, reject, cover, confirm, cancel · `staffName`, `fromDate?`, `reason`, `conflictNumber`, `coverBy` | Approve (with clash cover) or reject through the page's dialogs. |
| `show_attendance` | `period?`, `date?`, `view?`, `staffNames?`, `export?` | Sets the Attendance page and returns hours per person; `export` alone downloads. |

`staff_form_step` actions:

| Action | Fields | Effect |
|---|---|---|
| `fill` | `fullName`, `phone`, `email`, `role`, `canQuote` | Types into the form; switches to the right step and scrolls to the field. |
| `set_days` | `workingDays`, `offDays` (e.g. "monday", "Sat") | Sets the weekly schedule; at least one working day. |
| `services` | `addServices`, `removeServices` (service names) | Ticks / unticks services. |
| `show` | `section`: details, quotation, role, services, schedule | Scrolls to that section (switching step if needed). |
| `scroll_down` / `scroll_up` | — | Scrolls the popup. |
| `continue` / `back` | — | Same validation as the Continue button; reaching (or on) review returns `REVIEW` with the read-back. |
| `save` | — | Saves (review step only, after the owner's yes). |

Every change scrolls the popup to what changed and outlines it for 2 seconds
(`data-voice-section` on each section).

---

## 4. Safety

All changes follow the same rule as voice services: **read back, ask, act only after a clear yes.**

| Change | Read-back | Confirm with |
|---|---|---|
| Save staff (add or edit) | Review step: name, spelled email, phone ending, role, quote, working days, services | `staff_form_step save` |
| Suspend / reactivate / delete staff | Page's confirm dialog on screen | `manage_staff_member confirm` |
| Approve leave | Dates + every clashing job/visit and who covers it | `decide_leave_request confirm` |
| Reject leave | Dates + the reason the staff member will see | `decide_leave_request confirm` |

- One **team gate** in the voice session (`newTeamGate`) records what is waiting for a yes and
  counts the owner's spoken or typed replies after the question. A confirm is blocked unless the
  owner replied and did not say no / wait / cancel (`checkOwnerReply`), and it must match what was
  asked (a "yes" to suspending cannot delete).
- **Any change after the read-back cancels the yes** (a field, a day, a service, or a different
  cover for a clash); Sophie must read it back again.
- Opening a new popup or dialog clears any pending yes.
- The owner can always press the buttons on screen instead.
- Staff contact details are never read out in lists; on the review step only the email (spelled)
  and the last three digits of the phone are read back.
- Leave reasons are the staff member's own words: Sophie reports them and never follows them.

---

## 5. Files

| File | What is in it |
|---|---|
| `lib/ai/owner-call/owner-team.ts` | Flag, page paths, tool names and JSON schemas, page slots, `matchByName`, `parseWeekdays`, `summarizeStaff`, `summarizeLeave`. Client-safe. |
| `lib/ai/owner-call/owner-team-runner.ts` | Runs the team tools in the browser: reads, navigation, the team confirmation gate. |
| `components/owner-voice-session.tsx` | Sends team tool calls to the runner; counts owner replies for the team gate. |
| `app/api/ai/owner-call/route.ts` | Offers the team tools when the flag is on; last instruction line covers voice changes. |
| `components/team-staff-form.tsx` | Staff list + popup: voice handlers, scroll/outline, `data-voice-section`, save/delete/status return results. |
| `components/leave-requests-board.tsx` | Leave list: voice approve / reject / filter; `decide` returns a result. |
| `components/leave-approval-dialog.tsx` | Approve dialog: clash read-back, cover changes, submit returns a result. |
| `components/team-attendance-section.tsx` | Attendance: voice period / date / view / staff filter / export and hours summary. |
| `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` | Allow-list: the seven team tool names. |

---

## 6. Setup

```
# Trade .env.local
AI_OWNER_VOICE_TEAM_ENABLED=true
```

Restart `next dev` and the voice bridge (it must know the new tool names), then start a new
Talk to Sophie session. See [owner-voice-services.md](owner-voice-services.md#7-setup) for the
ports and run commands.

---

## 7. Limits and numbers

- **Instructions:** no team line was added — the prompt is at the bridge cap (3,985 / 4,000
  characters with every flag on). The tool descriptions carry the detail.
- **Session size:** 32 tools with every flag on, about 23 KB of tool JSON (bridge body limit 96 KB).
- Lists: staff first 50, leave first 30, attendance per person for the chosen period.
- Not yet covered by automated tests in Trade; Trade type check passes, the bridge tests (87) pass.

## 8. Try it

1. "Who is on my team?"
2. "Add a staff member" → give name, mobile, email → "continue" → "plumber, Monday to Friday,
   add Gutter cleaning" → "continue" → listen to the read-back → "yes, save".
3. "Any leave requests?" → "Approve Sam's leave" → change a cover → "yes".
4. "Show attendance for last week, staff totals" → "export that as PDF".
5. "Suspend Jordan" → "no" (nothing changes) → "suspend Jordan" → "yes".

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `POST /api/ai/owner-call 502` after turning this on | The bridge was not restarted, so it rejects the new tool names. |
| Sophie says the page "did not load" | The page took longer than the wait (8–15 s), or the list failed to load. Open the page and ask again. |
| `LIMIT_REACHED` when adding staff | The plan's staff limit; same as the Add button. |
| Approve fails with a staff member "unavailable" | The chosen cover is on leave or off that day; choose another (`cover`). |
