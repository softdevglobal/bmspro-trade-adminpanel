# Talk to Sophie: browser tools and MCP tools

Every owner voice action for **services**, the **team** and **AI knowledge drafts** exists twice:

- **Browser tools** — Sophie drives the real Trade pages on the owner's screen (popups, dialogs,
  buttons). The owner watches every change.
- **MCP tools** — Sophie asks the Trade server to do the same job through the owner MCP route.
  No page needs to be open.

Both use the same Trade API code, so the business rules are identical. One setting picks which
set Talk to Sophie offers:

```
AI_OWNER_VOICE_TOOL_MODE=browser   # default: drive the pages on screen
AI_OWNER_VOICE_TOOL_MODE=mcp       # run on the Trade server
```

The area flags still decide what is on at all: `AI_OWNER_VOICE_SERVICE_ENABLED`,
`AI_OWNER_VOICE_TEAM_ENABLED`, `AI_OWNER_VOICE_KNOWLEDGE_WRITE_ENABLED` (knowledge search,
`search_business_knowledge`, was already an MCP tool and is the same in both modes).

Feature guides: [owner-voice-services.md](owner-voice-services.md) (browser services),
[owner-voice-team.md](owner-voice-team.md) (browser team). This page covers both modes together.

---

## 1. The difference

| | Browser tools | MCP tools |
|---|---|---|
| Where they run | The owner's browser tab (`components/owner-voice-session.tsx` + the pages) | Trade server (`/api/ai/owner-call/mcp`) |
| Owner sees the change happen | Yes, on the real page | No, only hears the read-back |
| Needs Trade open in a browser | Yes (Sophie navigates there) | No |
| Usable from a channel with no screen | No | Yes, once that channel can authenticate to the MCP route (see §6) |
| Who checks the owner's "yes" | The browser, which hears the owner | The server (`confirmed: true` + timing), **plus** the browser check when used from Talk to Sophie |
| Catching a misheard email or name | The owner sees it in the form | Only through the spoken read-back |
| Rules (limits, emails, clashes, audit) | The page calls the Trade API | The MCP tool calls the **same** Trade API route handlers |

Rule of thumb: browser mode is safer when the owner is at the screen; MCP mode works anywhere.

---

## 2. Every action, both ways

### Services

| Job | Browser tool | MCP tool |
|---|---|---|
| List services | `list_services` | `get_services` |
| Add a service | `open_add_service_form` → `choose_service_source` → `service_form_step` (fill, steps, continue, save) | `prepare_service` → `create_service` |
| Edit a service | `open_edit_service_form` → `service_form_step` | `prepare_service_update` → `confirm_owner_change` |
| Delete a service | `delete_service` (prepare → confirm) | `prepare_service_delete` → `confirm_owner_change` |
| Scroll / show a section | `service_form_step` (scroll_down, scroll_up, show) | — (no screen) |

### Team

| Job | Browser tool | MCP tool |
|---|---|---|
| List staff | `list_staff` | `get_staff` |
| Add staff | `open_staff_form` → `staff_form_step` (fill, set_days, services, continue, save) | `prepare_staff_create` → `confirm_owner_change` |
| Edit staff | `open_staff_form` (staffName) → `staff_form_step` | `prepare_staff_update` → `confirm_owner_change` |
| Suspend / reactivate | `manage_staff_member` (suspend / reactivate → confirm) | `prepare_staff_status` → `confirm_owner_change` |
| Delete staff | `manage_staff_member` (delete → confirm) | `prepare_staff_delete` → `confirm_owner_change` |
| List leave requests | `list_leave_requests` | `get_leave_requests` |
| Approve leave (with clash cover) | `decide_leave_request` (approve → cover → confirm) | `prepare_leave_decision` (decision approve, covers) → `confirm_owner_change` |
| Reject leave | `decide_leave_request` (reject → confirm) | `prepare_leave_decision` (decision reject, reason) → `confirm_owner_change` |
| Attendance (read only) | `show_attendance` (sets the page, export PDF/CSV) | `get_attendance` |

### AI knowledge

| Job | Browser tool | MCP tool |
|---|---|---|
| Answer from the knowledge base (RAG search) | `search_business_knowledge` (MCP in both modes) | `search_business_knowledge` |
| List entries (title, kind, status, preview) | `list_knowledge` | `get_knowledge_entries` |
| Save a note as an unpublished draft | `prepare_knowledge_draft` → `save_knowledge_draft` / `discard_knowledge_draft` (shown on the AI knowledge page) | `prepare_knowledge_entry` → `confirm_owner_change` / `cancel_owner_change` |
| Edit a typed entry (FAQ, policy, note) | `open_knowledge_entry` → `knowledge_form_step` (fill → review → save) in the page's editor | `prepare_knowledge_update` → `confirm_owner_change` |
| Publish / unpublish an entry | `manage_knowledge_entry` (publish / unpublish → confirm); the entry stays outlined until confirmed | `prepare_knowledge_publish` → `confirm_owner_change` |
| Delete an entry | `manage_knowledge_entry` (delete → confirm) | `prepare_knowledge_delete` → `confirm_owner_change` |

Browser knowledge tools: `lib/ai/owner-call/owner-knowledge.ts` (definitions + runner) and
`components/ai-knowledge-board.tsx` (the page: its editor, Save as draft, Publish / Unpublish /
Delete). They use the page's own requests, without the browser's own "Are you sure?" box — the owner
already said yes to Sophie's read-back.

Knowledge rules by voice (both modes):

- **Publishing makes Sophie use the entry on customer calls**, so the read-back includes the text.
- Entries with **warnings** (personal details or instruction-like text) cannot be published by voice;
  the owner reviews and publishes them on the page, as the page itself requires.
- **Imported files, web pages and entries built from business settings cannot be edited by voice**
  (too long to read back, or they update themselves). Imported entries can still be published,
  unpublished or deleted; generated ones cannot be deleted.
- Voice text is limited to 2,000 characters, like voice drafts. Longer text belongs on the page.
- Edits use the entry's `version`, so a change made on the page in between is never overwritten
  (the API refuses it; prepare again).
- Importing files or web pages and re-indexing stay on the page.

When each tool works (flags, mode, pages, time limits): see
[owner-voice-browser-vs-mcp.md §7](owner-voice-browser-vs-mcp.md#7-when-each-tool-works).

**Only in browser mode:** scrolling and highlighting sections, exporting attendance files
(the download happens in the browser).
**Neither mode:** photo uploads (the browser only opens the file picker on the owner's own click).

---

## 3. How the MCP tools work

```
Sophie ── prepare_* ──► MCP route ──► ownerActionTools (lib/ai/mcp/tools/owner-actions.tools.ts)
                                        ├─ reads current data through the Trade API (as the owner)
                                        ├─ works out exactly what will change
                                        └─ stores ONE pending change: ai_owner_pending_changes/{businessId}_{uid}
       ◄── READY_TO_CONFIRM + summary (Sophie reads it back and asks)
Sophie ── confirm_owner_change {confirmed: true} ──►
                                        ├─ transaction: read + delete the pending change (applied once only)
                                        ├─ checkPendingChange: exists, < 30 min old, ≥ 5 s old, confirmed true
                                        ├─ rate limit: 30 confirmed changes per owner per hour
                                        └─ calls the same Trade route handler the page uses:
                                           PATCH/DELETE /api/services/:id · POST/PATCH/DELETE /api/team/staff
                                           PATCH /api/leave-requests/:id
                                           POST /api/ai/knowledge · PATCH/DELETE /api/ai/knowledge/:id
       ◄── DONE (or FAILED with the API's own error)
```

- **Same rules as the pages.** The MCP tools call the route handlers in-process with the owner's own
  login token, which each route checks again. Plan staff limit, duplicate email/phone, invitation
  emails, leave clash and reassignment rules, knowledge screening and the audit log are unchanged.
- **One pending change at a time.** A new `prepare_*` replaces the old one; `cancel_owner_change`
  drops it.
- **The read-back is exact.** The summary describes the stored change (e.g. every service step, every
  leave clash and who covers it), so what the owner hears is what will be applied.
- **Business and user always come from the login**, never from tool arguments.
- New services keep their existing pair `prepare_service` / `create_service`
  (`ai_owner_service_drafts`, `createBusinessService`).

---

## 4. Safety in both modes

| Check | Browser mode | MCP mode |
|---|---|---|
| Read-back before any change | Review step / dialog on screen + spoken | Spoken summary from `prepare_*` |
| Owner must answer, and not say no | Browser gate (`checkOwnerReply`) | Same browser gate in Talk to Sophie (`actionConfirm`) before `confirm_owner_change` is sent |
| Model must confirm | `save` / `confirm` actions only after the gate | `confirmed: true` |
| Too-fast or stale confirms | — | ≥ 5 s after prepare, < 30 min |
| Applied once only | Page button state | Firestore transaction |
| A change after the read-back | Cancels the yes | A new `prepare_*` replaces the pending change and restarts the yes check |
| Limits | The pages' own | 30 confirmed changes / owner / hour, plus the APIs' own |

---

## 5. Files

| File | Role |
|---|---|
| `lib/ai/owner-call/owner-actions.ts` | Mode setting, MCP tool names and JSON schemas, `checkPendingChange`, attendance periods, MCP-mode instructions. Pure. |
| `lib/ai/mcp/tools/owner-actions.tools.ts` | Server side of every MCP action: reads, prepare, confirm, cancel. |
| `lib/ai/owner-call/tools.ts` | `ownerVoiceToolList({ …, actions })` adds the MCP action tools. |
| `app/api/ai/owner-call/mcp/route.ts` | Serves the action tools (both modes), built per request from the owner's login. |
| `app/api/ai/owner-call/route.ts` | Offers browser or MCP tools by mode; MCP-mode instructions. |
| `components/owner-voice-session.tsx` | Browser tools; the yes check for `confirm_owner_change`; refreshes Services / Team after MCP changes. |
| `lib/ai/owner-call/owner-service.ts`, `owner-team.ts`, `owner-team-runner.ts`, `voice-draft*.ts` | Browser tools (see the feature guides). |
| `firestore.rules` | `ai_owner_pending_changes` is server-only. |
| `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` | Allow-list holds both sets. |
| `scripts/test-ai-owner-call.ts` | Tests: both modes offered correctly, served tools, pending-change rules, periods, name matching. |

---

## 6. Setup and switching

```
# Trade .env.local
AI_OWNER_VOICE_SERVICE_ENABLED=true
AI_OWNER_VOICE_TEAM_ENABLED=true
AI_OWNER_VOICE_KNOWLEDGE_WRITE_ENABLED=true   # knowledge drafts
AI_OWNER_VOICE_TOOL_MODE=browser              # or mcp
```

1. Change the mode, restart `next dev`, start a new Talk to Sophie session.
2. Restart the voice bridge after pulling (its allow-list must contain both sets).
3. Deploy `firestore.rules` (the new server-only collection).

**Other channels.** The MCP route authenticates the signed-in owner (their Firebase token), which is
what Talk to Sophie sends. A channel without a browser — for example an owner phoning in through
the bridge — needs its own way to authenticate as that owner before it can call these tools. That
part is not built yet; the tools themselves need no change.

---

## 7. Numbers

- Instructions with every flag on: **3,948 / 4,000** characters in browser mode, about **3,630** in MCP mode.
- Tools offered with every flag on: browser mode 36, MCP mode 34 (about 18–25 KB; bridge body limit 96 KB).
- Tests: `npm run test:ai-owner-call` (24 pass), `npm run test:ai-owner-service` (5 pass), bridge `npm test` (87 pass).

## 8. Try both

Browser mode: "Edit the LED light bulb service, make it 2 hours" — watch the popup.
MCP mode: the same sentence — Sophie reads back the change and asks; after "yes" the Services page
(if open) reloads with the new duration.

Same for "Approve Sam's leave", "Add a staff member", and "Save a note: call-out fee is $90".

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `POST /api/ai/owner-call 502` | The bridge does not know a tool name: restart it after pulling. |
| `NOTHING_PREPARED` on confirm | The pending change was cancelled, replaced, or already applied. Prepare again. |
| `EXPIRED` | More than 30 minutes since prepare. Prepare again. |
| `NOT_CONFIRMED` | Confirm sent before the owner answered, or within 5 s of prepare. |
| `FAILED` with an API message | The Trade API refused it (e.g. staff limit, email taken, clash cover unavailable). Same message the page shows. |
| Services / Team page not updated | MCP changes refresh an open Services page and the staff cache; reload other pages. |
