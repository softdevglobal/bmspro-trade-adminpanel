# Talk to Sophie: managing services by voice

The business owner can list, add, edit and delete their **services** by talking to Sophie
(dashboard → **Talk to Sophie**, voice or chat mode). Sophie drives the real Services page on the
owner's screen — the same popup, buttons and API the owner uses by hand — and never saves or
deletes anything without a clear "yes".

Turned on by `AI_OWNER_VOICE_SERVICE_ENABLED=true`. Off by default.

> **Two ways.** This page describes the **browser tools** (Sophie drives the Services page).
> Every service action also exists as an **MCP tool** that runs on the Trade server
> (`get_services`, `prepare_service`/`create_service`, `prepare_service_update`,
> `prepare_service_delete` → `confirm_owner_change`). `AI_OWNER_VOICE_TOOL_MODE` picks which set
> Talk to Sophie uses. See [owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md).

---

## 1. What the owner can say

| Owner says | What happens |
|---|---|
| "What services do I have?" / "How many services?" | Sophie reads the names (or the count), durations, live/paused and step counts. |
| "Add a service" | Services page opens with the **Add service** popup. Sophie asks: template or custom? |
| "Use the Gutter cleaning template" / "Custom" | Picks the template (or custom) in the popup. |
| "Call it Roof inspection, 2 hours" | Types the name and duration into the form. |
| "Add a step 'Check wiring'" (or "…as step 2") | Adds one job step. |
| "Change step 3 to 'Test the lights'" | Edits one step's title or description. |
| "Remove step 2" / "Move step 4 to 1" | Removes or reorders a step. |
| "Pause it" / "Make it live" | Flips the **Live in catalog / Paused** toggle. |
| "Show me the duration" | Scrolls to that section. |
| "Scroll down" / "Scroll up" | Scrolls the popup. |
| "Continue" / "Back" | Presses Continue / Back. |
| "Save" (after the read-back, with a clear yes) | Saves the service. |
| "Edit the LED light bulb service" | Opens the **Edit service** popup for it. |
| "Delete Power plant installation" | Opens the **Delete service?** dialog; deletes only after a clear yes. |

Every change scrolls the popup to what changed and outlines it for 2 seconds (a section, or the
exact step card). Uploading a **photo** is the one thing Sophie cannot do: browsers only open the
file picker on the owner's own click.

---

## 2. How it fits together

```
 Owner's browser                                   Trade server (Next.js)            Voice bridge         OpenAI
 ───────────────                                   ──────────────────────            ────────────         ──────
 Talk to Sophie ── POST /api/ai/owner-call (SDP) ─► builds instructions + tool list ─► checks secret,  ──► Realtime
                                                                                       tool names,        session
 ◄──────────────────────── WebRTC audio + "oai-events" data channel ──────────────────────────────────────►
        │
        │ Sophie asks for a tool (function_call)
        ▼
 owner-voice-session.tsx decides where it runs:
   ├─ BROWSER tools  → run right here, on the Services page (no server round trip)
   │                   └─ save / delete use the normal owner API: /api/services (POST, PATCH, DELETE)
   └─ SERVER tools   → POST /api/ai/owner-call/mcp  (JSON-RPC tools/call, owner's Firebase token)
                       └─ login check → rate limit → zod validation → tool → JSON result
```

The bridge only **starts** the session. It never runs a tool; it only refuses a session that
offers a tool name it does not know, or instructions over 4,000 characters.

### Why two kinds of tools

| | Browser tools | Server (MCP) tools |
|---|---|---|
| Where they run | `components/owner-voice-session.tsx` + the Services page | `app/api/ai/owner-call/mcp/route.ts` |
| Used for | Anything the owner sees and clicks: popups, fields, steps, scrolling, delete dialog | Reads and writes that need no screen: briefings, knowledge search, `prepare_service` / `create_service` |
| Security | Same as the owner clicking: the page calls `/api/services` with the owner's token | Login check, rate limit, zod validation; business and user always come from the login, never from tool arguments |
| Confirmation | Checked in the browser (it hears the owner's reply) | Checked in the browser before forwarding, and again on the server (`checkCreate`) |

"MCP" here is just the request format (JSON-RPC `tools/call`) on a normal Next.js route. All of
Sophie's read tools already went through it, so the server tools get the same login, rate limit
and validation for free.

---

## 3. The tools

### Browser tools (offered by `openAddServiceSessionTools()`)

| Tool | What it does |
|---|---|
| `list_services` | Read only. Calls `GET /api/services` and returns name, duration, live, step count and totals (first 50). |
| `open_add_service_form` | Goes to `/dashboard/services` and opens the **Add service** popup. |
| `choose_service_source` | `source: template \| custom` (+ `templateName`). Picks in the open popup; on no match returns the template names to read out. |
| `open_edit_service_form` | `serviceName`. Opens the **Edit service** popup for that service. `NO_MATCH` / `AMBIGUOUS` return the names to read out. |
| `service_form_step` | Drives the open Add / Edit popup — see actions below. |
| `delete_service` | `action: prepare \| confirm \| cancel`, `serviceName`. Uses the page's own **Delete service?** dialog. |

`service_form_step` actions:

| Action | Fields | Effect |
|---|---|---|
| `fill` | `name`, `durationMin` (15–720), `isActive`, `tasks` (replaces the whole list) | Types into the form, scrolls to the changed field. |
| `add_task` | `title`, `description?`, `toNumber?` | Inserts one step (default at the end). Max 12 steps. |
| `edit_task` | `taskNumber`, `title?`, `description?` | Changes one step. |
| `remove_task` | `taskNumber` | Removes one step. |
| `move_task` | `taskNumber`, `toNumber` | Moves one step. |
| `show` | `section`: photo, name, duration, tasks, live | Scrolls to that section. |
| `scroll_down` / `scroll_up` | — | Scrolls the popup by most of a screen. |
| `continue` / `back` | — | Next / previous step. Reaching (or already on) review returns `REVIEW` with the read-back. |
| `save` | — | Saves (only on the review step, only after the owner's yes). |

Steps are numbered from 1, as on screen. Every step action returns the new list
("Steps now: 1. …; 2. …") so Sophie can read it back.

### Server tools (MCP route, `lib/ai/owner-call/tools.ts` → `serviceTools`)

| Tool | What it does |
|---|---|
| `prepare_service` | Validates `name`, `durationMin`, `tasks` and stores **one pending draft** per owner in `ai_owner_service_drafts` (server-only collection, listed in `firestore.rules`). Creates nothing. |
| `create_service` | `confirmed: true`. In one transaction reads and deletes the stored draft, then creates the live service with `createBusinessService` (same function as `POST /api/services`) and writes an audit entry (`metadata.via = "owner_voice"`). Limit: 10 per owner per hour. |

These are the fallback when the owner dictates a whole service at once. The normal path is the
on-screen popup (`open_add_service_form` → `service_form_step`).

---

## 4. Safety: nothing is saved or deleted without a clear yes

1. **Read-back first.** Saving needs the popup's review step, which returns the full read-back
   (name, duration, live/paused, numbered steps). Deleting needs `delete_service prepare`, which
   shows the dialog and tells Sophie to ask "Should I delete X? This cannot be undone."
2. **The browser checks the owner's reply** (`checkOwnerReply` in `owner-service.ts`). The voice
   session counts the owner's turns after the question (spoken or typed) and keeps the transcript
   of the latest reply. `save`, `create_service` and `delete_service confirm` are blocked unless
   the owner replied after the question and did not say no / wait / cancel.
3. **Any change after the read-back cancels the yes.** A `fill` or step action after review
   resets the confirmation; Sophie must read it back again.
4. **Server check for `create_service`** (`checkCreate`): a stored draft must exist, be under 30
   minutes old and at least 5 seconds old (time to hear the read-back), and `confirmed` must be
   true. The draft is consumed in a transaction, so two calls can never create two services.
5. **The owner can always use the buttons.** Every popup and dialog is the normal UI.

---

## 5. Scrolling

The Add / Edit popup scrolls inside its own box, so the page keeps the right part in view:

- A new step (Continue / Back, by hand or by Sophie) starts at the top.
- An error message scrolls to the top so it is seen.
- Sophie's changes scroll to the changed section or step card and outline it for 2 seconds.

Sections are found by `data-voice-section="photo|name|duration|tasks|live"` and step cards by
`data-task-number="N"`.

---

## 6. Files

| File | What is in it |
|---|---|
| `lib/ai/owner-call/owner-service.ts` | Shared rules: flag, limits, tool names, JSON schemas, browser tool definitions, page registries (`registerServiceStepHandler`, `registerServicesPageVoice`, …), `matchServiceByName`, `summarizeServices`, `checkCreate`, `checkOwnerReply`, `OWNER_SERVICE_INSTRUCTIONS`. No server-only imports. |
| `lib/ai/mcp/tools/owner-service.tools.ts` | Server side of `prepare_service` / `create_service` (Firestore draft, transaction, create, audit, rate limit). |
| `lib/ai/owner-call/tools.ts` | Owner tool list. `ownerVoiceToolList({ knowledge, services })` adds the two server tools when the flag is on. |
| `app/api/ai/owner-call/route.ts` | Session start: adds the service instructions and offers server + browser service tools. |
| `app/api/ai/owner-call/mcp/route.ts` | MCP route: builds the service tools per request from the login (`ownerServices`). |
| `components/owner-voice-session.tsx` | Runs the browser tools, the confirmation gates, and forwards server tools to the MCP route. |
| `app/dashboard/services/page.tsx` | Services page and Add / Edit popup: registers the voice handlers, scroll + outline, step actions, edit / delete for voice. |
| `components/service-owner-wizard-steps.tsx` | `data-voice-section` on photo, name, duration, tasks and the live toggle. |
| `components/service-task-sortable-list.tsx` | `data-task-number` on each step card. |
| `firestore.rules` | `ai_owner_service_drafts` is server-only. |
| `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` | Bridge allow-list: `prepare_service`, `create_service`, `open_add_service_form`, `choose_service_source`, `service_form_step`, `open_edit_service_form`, `delete_service`, `list_services`. |

---

## 7. Setup

**Trade `.env.local`**

```
AI_OWNER_VOICE_SERVICE_ENABLED=true            # turn the feature on
AI_OWNER_VOICE_BRIDGE_URL=http://127.0.0.1:8788 # your local bridge
AI_VOICE_BRIDGE_SECRET=...                     # must match the bridge
```

**Bridge `.env`**: `BMSPRO_PORT=8788` (8787 is kept free for the other developer's phone tests).

Run, in two terminals:

```powershell
# bridge
cd bmspro-voice-bridge
node --env-file=.env --env-file=.env.trade-direct-pilot bridge.mjs

# Trade
cd bmspro-trade-adminpanel/bmspro-trade-adminpanel
npm run dev
```

Restart both after changing env files, the bridge allow-list, or tool names. The SSH tunnel
(`ssh -R 8787:…`) is only for phone calls, not for Talk to Sophie.

---

## 8. Rules for future changes

- **New tool name → add it to the bridge allow-list first**, or every session fails with
  `POST /api/ai/owner-call 502`. Prefer a new `action` on `service_form_step` when it fits — that
  needs no bridge change.
- **Instructions are capped at 4,000 characters** by the bridge. With every flag on they are
  currently **3,981**. Put detail in tool descriptions (no cap), not in `OWNER_SERVICE_INSTRUCTIONS`.
- Business and user always come from the login, never from tool arguments.
- Writes that bypass the on-screen popup must keep a read-back and a server-side check like
  `checkCreate`.

## 9. Troubleshooting

| Symptom | Cause |
|---|---|
| `POST /api/ai/owner-call 502` | The bridge refused the session. Check the Trade log line `Voice bridge connection rejected { status }`: **400** unknown tool name or instructions too long (restart the bridge after allow-list changes), **401** secret mismatch, **5xx** OpenAI refused (see the bridge log). |
| `POST /api/ai/owner-call 503` | The bridge is not running or `AI_OWNER_VOICE_BRIDGE_URL` is wrong. |
| `GET /api/business/live-calls 502` | `AI_LIVE_LISTEN_BRIDGE_URL` points at a port with no bridge (Listen live, phone calls only). |
| Sophie says she cannot do something on screen | The action is missing from `service_form_step`, or the session started before the change: reload and start a new session. |
| Sophie mishears ("install" for "scroll") | Speech-to-text. Repeat more clearly, or use the buttons. |

## 10. Known limits

- Photo upload is by hand only.
- `list_services` returns the first 50 services.
- Voice save and delete need the Services page open in this browser tab (Sophie navigates there herself).
- Not yet covered by automated tests in Trade; the bridge tests (87) pass.
