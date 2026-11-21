# Talk to Sophie: managing the Item list by voice

**Status: built** (browser tools and MCP tools). Same design as
[owner-voice-services.md](owner-voice-services.md) and [owner-voice-mcp-and-browser.md](owner-voice-mcp-and-browser.md).

The **Item list** (dashboard → Item list, `/dashboard/items`) holds the reusable line items and
prices used in quotations. The business owner can list, add, edit and delete items by talking to
Sophie (Talk to Sophie, voice or chat mode). Sophie either drives the real Item list page on the
owner's screen (browser tools) or does the same job on the Trade server (MCP tools). Nothing is
saved or deleted without a read-back and a clear "yes".

Turned on by `AI_OWNER_VOICE_ITEMS_ENABLED=true`. Off by default.

---

## 1. What the owner can say

| Owner says | What happens |
|---|---|
| "What items do I have?" / "How many items?" | Sophie reads the names, codes and prices (as dollars and cents), or the count. |
| "How much is the CCTV replacing?" | Sophie reads that item's price. |
| "Search for cable" | Lists matching items; if the Item list is open, its search box shows the same. |
| "Add an item" | The Item list opens with the **Add item** popup. |
| "Call it Smoke alarm install, forty five dollars" | Types the name and price ($45.00). |
| "Code SA-001" / "Description: supply and fit" | Types the code and description. "No code" clears it. |
| "Show me the price" / "Scroll down" | Scrolls to that field (and outlines it) / scrolls the popup. |
| "Continue" / "Back" | Review step (Sophie says what is wrong, e.g. a code another item uses) / back to details. |
| "Save" (after the read-back, with a clear yes) | Saves the item. |
| "Change the price of Power plant to three thousand" | Opens **Edit item** for it, changes the price, reads it back. |
| "Rename CCTV replacing to CCTV replacement" | Changes the name. |
| "Delete Power plant installation" | Opens **Delete item?**; deletes only after a clear yes. |

**Sophie cannot upload a photo or a PDF.** Browsers only open the file picker on the owner's own
click, so Sophie tells the owner to use the buttons for those. Existing photos and PDFs are kept
when Sophie edits an item.

---

## 2. The tools

### Browser tools (`lib/ai/owner-call/owner-item.ts`)

| Tool | What it does |
|---|---|
| `list_items` | Read only. `GET /api/items`: name, code, price, whether a PDF is attached, total (first 50). Optional `search` (name, code or description); the open page's search box follows. |
| `open_add_item_form` | Goes to `/dashboard/items` and opens **Add item**. |
| `open_edit_item_form` | `itemName`. Opens **Edit item**. `NO_MATCH` / `AMBIGUOUS` return the names to read out. |
| `item_form_step` | Drives the open popup (actions below). |
| `delete_item` | `action: prepare \| confirm \| cancel`, `itemName`. Uses the page's own **Delete item?** dialog. |

`item_form_step` actions:

| Action | Fields | Effect |
|---|---|---|
| `fill` | `name`, `priceAud`, `code`, `description` ("" clears code or description) | Types into the form, scrolls to and outlines the changed field. Warns at once if the code is used by another item. |
| `show` | `section`: photo, code, name, description, price, document | Scrolls to that field. |
| `scroll_down` / `scroll_up` | — | Scrolls the popup. |
| `continue` / `back` | — | Same checks as the Continue button; reaching (or on) review returns `REVIEW` with the read-back. |
| `save` | — | Saves (review step only, after the owner's yes). |

### MCP tools (`lib/ai/owner-call/owner-actions.ts` + `lib/ai/mcp/tools/owner-actions.tools.ts`)

| Tool | What it does |
|---|---|
| `get_items` | Read only. Same summary and search as `list_items`. |
| `prepare_item_create` | `name`, `priceAud`, optional `code`, `description`. Checks limits and duplicate codes; says if this **updates** an item with the same name. Changes nothing. |
| `prepare_item_update` | `itemName` plus the fields to change. Before and after summary. Refuses a name another item already has. |
| `prepare_item_delete` | `itemName`. Summary and "cannot be undone". |
| `confirm_owner_change` / `cancel_owner_change` | The shared tools. Confirm runs the stored change through `POST /api/items`, `PATCH` / `DELETE /api/items/:id`. |

`AI_OWNER_VOICE_TOOL_MODE=browser` (default) offers the browser tools; `mcp` offers the MCP tools.
Both use the same `/api/items` handlers, so validation, the owner/admin check and the audit log
(`item.created`, `item.updated`, `item.deleted`) are identical.

---

## 3. Safety: nothing is saved or deleted without a clear yes

1. **Read-back first.** Browser: the review step's read-back (name, code, description, price,
   photo, document). MCP: the `prepare_item_*` summary. Delete: the dialog and "Should I delete X?
   This cannot be undone."
2. **The owner's reply is checked** in the browser (`checkOwnerReply`, gate `item_save` /
   `item_delete`; in MCP mode `actionConfirm`): the owner must answer after the question and not say
   no, wait or cancel.
3. **Any change after the read-back cancels the yes.** Sophie must read it back again.
4. **MCP changes** need a stored pending change at least 5 seconds and under 30 minutes old, plus
   `confirmed: true`, claimed once in a transaction; 30 confirmed changes per owner per hour.
5. **Money is read back as dollars and cents** ("$45.00"), rounded to cents, because a misheard
   price goes straight into quotations.
6. **Same name means update.** `POST /api/items` updates an item with the same name (ignoring case
   and extra spaces) instead of adding a second one. The read-back says "An item named X already
   exists at $800: saving updates it", and the result says "updated", not "added".
7. **Duplicate codes are blocked** by the same rule as the popup (`duplicateItemCodeError`).
8. **Owner and admin only** (the API's rule). Business and user come from the login.
9. **The owner can always use the buttons.**

---

## 4. Files

| File | Change |
|---|---|
| `lib/ai/owner-call/owner-item.ts` | Flag `ownerItemsEnabled()`, limits, tool names and schemas, page connections, `summarizeItems`, `formatAud`, `itemNameKey`, the browser runner. |
| `lib/ai/owner-call/owner-actions.ts` | `items` area: `get_items`, `prepare_item_*`, change kinds `item_create` / `item_update` / `item_delete`. |
| `lib/ai/mcp/tools/owner-actions.tools.ts` | `getItems`, `prepareItemCreate`, `prepareItemUpdate`, `prepareItemDelete`; confirm runs them through `/api/items`. |
| `lib/ai/owner-call/tools.ts` | `ownerVoiceToolList({ items })`. |
| `app/api/ai/owner-call/route.ts`, `.../mcp/route.ts` | Offer / serve the item tools when the flag is on. |
| `components/owner-voice-session.tsx` | Runs the browser item tools; `itemConfirm` gate. |
| `components/item-list-board.tsx` | Voice handlers for the page and the popup; `data-voice-section` markers; scroll and outline; save and delete return results; a fresh popup per item. |
| `bmspro-voice-bridge/src/agents/trade/trade-owner-voice.mjs` | Allow-list: the nine item tool names. |
| `scripts/test-ai-owner-call.ts` | Item flag, both modes, price format, name rule, search. |

No new Firestore collection: MCP changes use the shared `ai_owner_pending_changes`.

---

## 5. Setup

```
# Trade .env.local
AI_OWNER_VOICE_ITEMS_ENABLED=true
AI_OWNER_VOICE_TOOL_MODE=browser        # or mcp
```

Restart the voice bridge (new tool names) and `next dev`, then start a new Talk to Sophie session.
Ports and run commands: [owner-voice-services.md](owner-voice-services.md) §7.

## 6. When it works

As for every voice area ([owner-voice-browser-vs-mcp.md §7](owner-voice-browser-vs-mcp.md#7-when-each-tool-works)):
owner signed in with Sophie Talk enabled, a session open, the bridge running, the items flag on.
Browser tools also need Trade open in the tab (Sophie navigates to the Item list herself and waits
up to 8 s for the list); MCP tools need no page.

## 7. Decisions on the plan's open questions

1. **Owner only by voice.** Talk to Sophie is owner only; the API also allows admins, which is
   unchanged for the page.
2. **No bulk price changes** ("raise everything by 5 percent"): one item at a time, each read back.
3. **Quotations still auto-create items.** Sophie's list tools always read live data.
4. **Photo and PDF stay hand-upload only.**

## 8. Known limits

- Photo and PDF upload is by hand only.
- Lists return the first 50 items (with the total).
- An MCP change does not refresh an open Item list page; press Refresh or reopen it.
- Covered by unit tests for flags, tool lists, price format and search; not yet tried in a live
  voice session.
