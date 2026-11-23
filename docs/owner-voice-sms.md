# Talk to Sophie: the SMS section by voice

**Status: built** (browser tools and MCP tools). Unit tested; not yet tried in a live voice session.
Built as planned, with two simplifications: the MCP send calls the route handler directly, so
`lib/sms/custom-message-send.ts` was not needed; and the voice send limit lives in the route, which
applies it to requests carrying the `x-bms-voice: 1` header. Section 7's open questions use the plan's
defaults. It follows the same design as
[owner-voice-items.md](owner-voice-items.md), [owner-voice-services.md](owner-voice-services.md) and
[owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md).

The SMS section has three pages in the dashboard:

| Page | Path | Component | API |
|---|---|---|---|
| SMS Credits | `/dashboard/sms` | `components/owner-sms-board.tsx` | `GET /api/business/sms` |
| SMS log | `/dashboard/sms/log` | `components/sms-log-board.tsx` → `sms-delivery-log.tsx` | `GET /api/business/sms-log` (last 100) |
| Custom messages | `/dashboard/sms/custom-messages` | `components/owner-custom-messages-board.tsx` | `GET` / `POST /api/business/custom-messages` |

The business owner can use all three pages by talking to Sophie. Talk to Sophie works by voice or
by typing in chat mode, and every tool below works the same in both. Sophie can do the job in either
of two ways:
- **Browser tools** drive the real pages on the owner's screen.
- **MCP tools** do the same job on the Trade server, with no page open.

Nothing is sent without a read-back and a clear "yes".

**Not included:** buying a top-up package. That is a Stripe payment, so the owner always does it by
hand. Sophie can read the balance and say a top-up is needed, but she never starts a checkout.

The feature is switched on by `AI_OWNER_VOICE_SMS_ENABLED=true` and is off by default.

---

## 1. What the owner can say

### SMS Credits (check the balance)

| Owner says | What happens |
|---|---|
| "How many SMS do I have left?" | Sophie reads the remaining count, for example "724 left, 276 used of 1,000". |
| "What plan am I on?" | Sophie reads the current plan, for example "test 100 sms". |
| "Open SMS credits" | The SMS Credits page opens. |
| "Top up 500" | Sophie opens SMS Credits and says: "Press Top up package on the 500 card to pay." She never pays. |

### SMS log (list and search)

| Owner says | What happens |
|---|---|
| "Show me the SMS log" | The SMS log opens. Sophie reads the newest few messages: when, to whom, the kind of message and the status. |
| "How many texts did we send this week?" | Sophie gives the count, grouped by kind (Invoice sent, Customer welcome and so on). |
| "Search the log for 0412 345 678" / "for invoice" / "for failed" | The page's search box shows the same search, and Sophie reads the matches. |
| "Did the invoice text to John go out?" | Sophie finds the entry and reads its status (Sent / Failed / Skipped) and the detail. |
| "Next page" / "Previous page" / "Scroll down" | Moves through the log. |
| "Read me that message" | Sophie reads the full text of one entry. |

### Custom messages (write and send)

| Owner says | What happens |
|---|---|
| "Send a message to my customers" | The Custom messages page opens. |
| "Write: we're closed from the 24th to the 2nd" | Sophie types the message. She can tidy the owner's words if asked ("make it friendlier"), and the read-back always uses the exact final text. |
| "Use the Merry Christmas one" | Sophie picks that quick template (Season's greetings, Merry Christmas or Happy New Year). |
| "Send it to everyone" | Recipients are set to **All customers (N)**. |
| "Only send it to John Smith and Mary" | Recipients are set to **Select customers**, and those names are ticked. |
| "Who are my customers?" / "Search customers for Lynbrook" | Sophie lists the customers who have a phone number, filtered by name or phone. |
| "Add Peter" / "Remove Mary" / "Select all" / "Clear" | Changes the ticked customers. **Select all** ticks only the customers shown by the current search, like the button on the page. |
| "Read it back" / "Review" | Sophie reads what will be sent: the exact text customers receive (with the business name in front), the number of recipients, the credits it uses, and the balance afterwards. |
| "Yes, send it" (after the read-back) | Sends the message and reports, for example, "Sent to 2 customers." |
| "Cancel" / "Don't send" | Clears the yes. Nothing is sent. The text stays on the page so the owner can change it. |

---

## 2. The tools

### Browser tools (`lib/ai/owner-call/owner-sms.ts`, new)

| Tool | What it does |
|---|---|
| `show_sms_balance` | Read only. Calls `GET /api/business/sms`, which returns remaining, used, total, plan name and whether it is unlimited. With `open: true` it also opens `/dashboard/sms`. |
| `list_sms_log` | Read only. Opens `/dashboard/sms/log`, then reads the log. Arguments: `search` (receiver, message, status or kind; the page's search box shows the same), `page`, `status` (sent / failed / skipped), `since` (YYYY-MM-DD). Returns up to 10 rows plus the total. |
| `list_sms_customers` | Read only. `GET /api/business/custom-messages`: customers who have a phone number (name and phone) plus the balance. Optional `search`; up to 50 names plus the total. |
| `open_custom_message` | Opens `/dashboard/sms/custom-messages` and connects to its form. |
| `sms_message_step` | Drives the open Custom messages form (actions below). |

`sms_message_step` actions:

| Action | Fields | Effect |
|---|---|---|
| `write` | `message` | Types the text into the box. Too long: it returns `TOO_LONG` with the limit, and Sophie shortens the text with the owner. |
| `template` | `template`: seasons_greetings, merry_christmas, happy_new_year | Same as pressing that quick template chip. |
| `recipients_all` | — | Ticks **All customers**. |
| `recipients_select` | `add: string[]`, `remove: string[]` | Ticks **Select customers**, then ticks or unticks by name. `NO_MATCH` and `AMBIGUOUS` return the names to read out, for example two customers called "John". |
| `search` | `query` | Types in the page's **Search name or phone** box. |
| `select_all_shown` / `clear_selection` | — | The **Select all** and **Clear** buttons. |
| `scroll_down` / `scroll_up` | — | Scrolls the page. |
| `review` | — | Returns `REVIEW` with the read-back (exact outbound text, recipients, credits, balance after) and starts the yes check. It returns `NOT_ENOUGH_CREDITS` if the balance is too low. |
| `send` | — | Presses **Send SMS**. Works only after `review` and a checked yes. Returns `SENT` with `sentCount` and `requestedCount`. |
| `cancel` | — | Clears the yes. Nothing is sent. |

### MCP tools (`owner-actions.ts` and `lib/ai/mcp/tools/owner-actions.tools.ts`)

| Tool | What it does |
|---|---|
| `get_sms_balance` | Read only. Same data as `show_sms_balance`. |
| `get_sms_log` | Read only. Same search, filters and paging as `list_sms_log`. |
| `get_sms_customers` | Read only. Same as `list_sms_customers`. |
| `prepare_sms_send` | Arguments: `message`, plus `recipients: "all"` or `customerNames: string[]`. It checks the text length, resolves the names (`NO_MATCH` / `AMBIGUOUS`) and checks the credits. It stores one pending change of kind `sms_send` and sends nothing. The result is the read-back. |
| `confirm_owner_change` / `cancel_owner_change` | The shared tools. Confirm sends the stored message through the same code as `POST /api/business/custom-messages`. |

`AI_OWNER_VOICE_TOOL_MODE=browser` (the default) offers the browser tools, and `mcp` offers the MCP
tools. Both send through the same server code, so the business-name prefix, the 480-character limit,
the credit deduction and the SMS log entry (`source: "custom_message"`) are the same either way.

**The MCP pending change stores customer keys, not names.** The keys are the same
`email:` / `phone:` / `name:` ids the page uses. Confirm sends to exactly the people who were read
back, even if a customer is added in the meantime. "All" is stored as the list of keys at prepare
time, not as `"all"`.

---

## 3. Safety: nothing is sent without a clear yes

Sending a text is the riskiest action in this section. It goes to real customers, it costs credits,
and **it cannot be undone**. These rules apply:

1. **Read-back first.** Sophie reads the exact text customers will receive, with the business name in
   front, for example: "Nira Electrical Lynbrook: Merry Christmas from all of us! …". She says how many
   customers get it ("all 2 customers", or the names when there are 5 or fewer), and the credits it
   uses and leaves.
2. **The owner's reply is checked** with `checkOwnerReply` and a new `sms_send` gate. In MCP mode
   the check is `actionConfirm`. The owner must answer after the question and must not say no, wait
   or cancel.
3. **Any change after the read-back cancels the yes.** That includes the text, a template or the
   recipients. Sophie must review again.
4. **"Send to everyone" is said out loud as a number**, for example "This goes to all 48 customers
   and uses 48 credits", so a misheard "all" is caught.
5. **Credits are checked twice:** at review, and again by the server when it sends. If there aren't
   enough, Sophie says so and points to SMS Credits. She never tops up.
6. **MCP changes** need a stored pending change that is at least 5 seconds and under 30 minutes old,
   plus `confirmed: true`. The change is claimed once, in a transaction.
7. **Send limit by voice:** 3 voice sends per owner per hour. This is separate from the 30 changes
   per hour, because one send can reach every customer.
8. **Owner only**, through `requireBusinessOwner`. The business comes from the login, never from what
   was said.
9. **Read-only tools never send.** Listing, searching and the balance change nothing.
10. **The owner can always use the buttons.**

---

## 4. Files

| File | Change |
|---|---|
| `lib/ai/owner-call/owner-sms.ts` (new) | Flag `ownerSmsEnabled()`, limits, tool names and schemas, page slots (`smsLogVoice`, `smsMessageVoice`), `summarizeSmsLog`, `previewOutboundMessage` (moved out of the board so the read-back and the page match), the browser runner. |
| `lib/ai/owner-call/owner-actions.ts` | New `sms` area: `get_sms_balance`, `get_sms_log`, `get_sms_customers`, `prepare_sms_send`. New pending kind `sms_send`. |
| `lib/ai/mcp/tools/owner-actions.tools.ts` | `getSmsBalance`, `getSmsLog`, `getSmsCustomers`, `prepareSmsSend`. Confirm sends through the shared send function. |
| `lib/sms/custom-message-send.ts` (new) | `buildCustomerContacts`, `withBusinessName` and the send, moved out of the route so the route and confirm share one copy. |
| `app/api/business/custom-messages/route.ts` | Uses the shared send function. Behaviour stays the same. |
| `lib/ai/owner-call/tools.ts` | `ownerVoiceToolList({ sms })`. |
| `lib/ai/owner-call/owner-page.ts` | Adds `sms_credits`, `sms_log` and `custom_messages` to `control_page` (the current `sms` entry stays as SMS Credits). |
| `app/api/ai/owner-call/route.ts`, `.../mcp/route.ts` | Offer and serve the SMS tools when the flag is on. Short SMS rules go in the instructions, which must stay under 4,000 characters. |
| `components/owner-voice-session.tsx` | Runs the browser SMS tools. Adds the `smsConfirm` gate, which `SENT` and `CANCELLED` reset. |
| `components/owner-custom-messages-board.tsx` | Voice handlers for write, template, recipients, search, select, review, send and cancel. `send` reuses `handleSubmit` and returns its result. |
| `components/sms-delivery-log.tsx` | Voice handlers for search, page and status filter. The search box and page follow Sophie. |
| `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` | Allow-list: the 9 SMS tool names below. |
| `scripts/test-ai-owner-call.ts` | SMS flag, both modes, outbound preview and length, name matching, credit check, rule that the yes resets after a change. |

Names to add to the bridge allow-list:

```
show_sms_balance, list_sms_log, list_sms_customers, open_custom_message, sms_message_step,
get_sms_balance, get_sms_log, get_sms_customers, prepare_sms_send
```

No new Firestore collection is needed. MCP sends use the shared `ai_owner_pending_changes`.

---

## 5. Setup (after it is built)

```
# Trade .env.local
AI_OWNER_VOICE_SMS_ENABLED=true
AI_OWNER_VOICE_TOOL_MODE=browser        # or mcp
```

Restart the voice bridge (it has new tool names) and `next dev`, then start a new Talk to Sophie
session.

---

## 6. Things to know before building

1. **The customer list comes from inspection requests.** Both `GET` and `POST` on
   `/api/business/custom-messages` read **every** inspection request of the business
   (`listInspectionRequests`) to build the list of phone numbers. Voice adds more of these reads,
   because each search and the confirm step reload the list. Plan: one read per voice step, kept in
   the page for browser tools. Later, switch the route to the Customers collection or a cached
   contacts list; see [firestore-read-reductions.md](firestore-read-reductions.md).
2. **The log only holds the last 100 messages**, and its search runs in the browser. "How many this
   month" is right only within those 100, so Sophie says "in the last 100 messages" when the log is
   full.
3. **Duplicate names.** Customer ids are `email:` / `phone:` / `name:` keys, but the owner says names.
   When two customers share a name, Sophie reads both phone numbers and asks which one.
4. **Long dictated messages.** The limit is 480 characters including "Business name: ". Sophie
   says when the text is too long and offers a shorter version. She never cuts it silently.
5. **Unlimited plans** skip the credit check, as the page does.

## 7. Open questions

1. Should Sophie be allowed to send to **all** customers by voice, or only to selected customers?
   The plan allows both, with the count read back.
2. Is the limit of 3 voice sends per hour right?
3. Should "read the log" include system texts (invoice, welcome, reminder), or only custom messages?
   The plan includes all of them, as the page does.
