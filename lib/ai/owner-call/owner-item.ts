/**
 * Voice Item list (catalog items used in quotations), browser tools: Sophie drives the Item list
 * page on the owner's screen — its search, Add / Edit item popup and delete dialog. The MCP twins
 * are get_items and prepare_item_create / _update / _delete (owner-actions.ts).
 *
 *   list_items            read the items (and filter the page if it is open)
 *   open_add_item_form    open Add item on the Item list page
 *   open_edit_item_form   open Edit item for one item
 *   item_form_step        fill, show, scroll, continue, back, save in the open popup
 *   delete_item           prepare (opens the delete dialog), confirm, cancel
 *
 * Plan and rules: docs/owner-voice-items.md. Pure apart from fetch: no server-only imports.
 */
import { ask, blocked, clear, type TeamGate } from "./owner-team-runner";
import { type VoiceResult } from "./owner-team";

/** Feature flag, off unless set. Separate from the other areas so it can be switched off alone. */
export function ownerItemsEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.AI_OWNER_VOICE_ITEMS_ENABLED === "true";
}

export const ITEMS_PAGE = "/dashboard/items";
/** Same limits as parseCatalogItemInput (lib/items/server.ts). */
export const ITEM_LIMITS = { nameMax: 200, codeMax: 50, descriptionMax: 500, listMax: 50 } as const;

export const LIST_ITEMS_TOOL = "list_items";
export const OPEN_ADD_ITEM_TOOL = "open_add_item_form";
export const OPEN_EDIT_ITEM_TOOL = "open_edit_item_form";
export const ITEM_FORM_TOOL = "item_form_step";
export const DELETE_ITEM_TOOL = "delete_item";
export const OWNER_ITEM_TOOL_NAMES = [LIST_ITEMS_TOOL, OPEN_ADD_ITEM_TOOL, OPEN_EDIT_ITEM_TOOL, ITEM_FORM_TOOL, DELETE_ITEM_TOOL] as const;
export type OwnerItemToolName = (typeof OWNER_ITEM_TOOL_NAMES)[number];
export const isOwnerItemTool = (name: string): name is OwnerItemToolName => (OWNER_ITEM_TOOL_NAMES as readonly string[]).includes(name);

export const ITEM_FORM_ACTIONS = ["fill", "show", "scroll_down", "scroll_up", "continue", "back", "save"] as const;
export const ITEM_FORM_SECTIONS = ["photo", "code", "name", "description", "price", "document"] as const;
export type ItemFormArgs = {
  action: (typeof ITEM_FORM_ACTIONS)[number];
  name?: string;
  priceAud?: number;
  /** Empty string clears it. */
  code?: string;
  /** Empty string clears it. */
  description?: string;
  section?: (typeof ITEM_FORM_SECTIONS)[number];
};

/** Money is always read back as dollars and cents, because a misheard price goes straight into quotations. */
export const formatAud = (value: number) => `$${value.toFixed(2)}`;
/** Same name rule as the server (a new item with the same name updates the existing one). */
export const itemNameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Shapes GET /api/items rows for Sophie. */
export function summarizeItems(
  rows: { name: string; code: string | null; priceAud: number; description?: string | null; documentUrl?: string | null }[],
  search = "",
) {
  const words = search.trim().toLowerCase();
  const visible = words
    ? rows.filter((row) => row.name.toLowerCase().includes(words) || (row.code?.toLowerCase().includes(words) ?? false)
      || (row.description?.toLowerCase().includes(words) ?? false))
    : rows;
  return {
    status: visible.length ? "OK" : rows.length ? "NO_MATCH" : "NO_ITEMS",
    total: rows.length,
    shown: Math.min(visible.length, ITEM_LIMITS.listMax),
    items: visible.slice(0, ITEM_LIMITS.listMax).map((row) => ({
      name: row.name, code: row.code, price: formatAud(row.priceAud), hasDocument: Boolean(row.documentUrl),
    })),
    complete: visible.length <= ITEM_LIMITS.listMax,
    message: rows.length
      ? "Read names and prices (as dollars and cents), or the count if that is all the owner asked."
      : "There are no items yet. Items are also added automatically when a quotation is sent.",
  };
}

// ---- Page connections ----------------------------------------------------------------------------

export type ItemsPageVoice = {
  setSearch(search: string): void;
  openAdd(): VoiceResult;
  openEdit(itemName: string): VoiceResult;
  prepareDelete(itemName: string): VoiceResult;
  confirmDelete(): Promise<VoiceResult>;
  cancel(): VoiceResult;
};
export type ItemFormVoice = { step(args: ItemFormArgs): VoiceResult | Promise<VoiceResult> };

function slot<T>(missing: string) {
  let current: T | null = null;
  return {
    register(handler: T) { current = handler; return () => { if (current === handler) current = null; }; },
    current: () => current,
    async run(apply: (handler: T) => VoiceResult | Promise<VoiceResult>, timeoutMs = 8_000): Promise<VoiceResult> {
      const until = Date.now() + timeoutMs;
      while (!current && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
      return current ? apply(current) : { status: "NOT_OPEN", message: missing };
    },
  };
}
export const itemsPageVoice = slot<ItemsPageVoice>("The Item list did not load. Ask the owner to open it, then try again.");
export const itemFormVoice = slot<ItemFormVoice>("No item popup is open. Call open_add_item_form or open_edit_item_form first.");

// ---- Realtime tool definitions (JSON Schema) -----------------------------------------------------

export function ownerItemSessionTools() {
  return [
    {
      type: "function", name: LIST_ITEMS_TOOL,
      description: "List the Item list (catalog items used in quotations): name, code, price, whether a PDF is attached, and the total. " +
        "Optional search words (name, code or description); if the Item list page is open its search box follows. Read only. " +
        "Use it for prices too, e.g. how much is an item.",
      parameters: { type: "object", properties: { search: { type: "string" } }, additionalProperties: false },
    },
    {
      type: "function", name: OPEN_ADD_ITEM_TOOL,
      description: "Go to the Item list and open the Add item popup. Then ask for the name and price (and code or description if the owner wants) " +
        "and use item_form_step.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function", name: OPEN_EDIT_ITEM_TOOL,
      description: "Go to the Item list and open Edit item for itemName (NO_MATCH or AMBIGUOUS: read out the names and ask). Then use item_form_step.",
      parameters: { type: "object", properties: { itemName: { type: "string" } }, required: ["itemName"], additionalProperties: false },
    },
    {
      type: "function", name: ITEM_FORM_TOOL,
      description: "Drive the open Add or Edit item popup like the owner. fill types name, priceAud (Australian dollars, e.g. 45 or 45.5), code and " +
        "description (an empty string clears code or description). show scrolls to a section (photo, code, name, description, price, document); " +
        "scroll_down and scroll_up scroll. continue goes to the review step (it reports anything wrong, e.g. a code another item uses); back returns. " +
        "save only on the review step, only after you read back name, code, description and the price as dollars and cents and the owner clearly " +
        "said yes. If the review says an item with this name exists, say it will update that item, not add a new one. A photo or PDF can only be " +
        "uploaded by the owner.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ITEM_FORM_ACTIONS },
          name: { type: "string" }, priceAud: { type: "number", minimum: 0 }, code: { type: "string" }, description: { type: "string" },
          section: { type: "string", enum: ITEM_FORM_SECTIONS },
        },
        required: ["action"], additionalProperties: false,
      },
    },
    {
      type: "function", name: DELETE_ITEM_TOOL,
      description: "Delete an item through the Item list's own delete dialog. prepare opens it for itemName and deletes nothing; then ask: Should I " +
        "delete <name>? This cannot be undone. confirm only after a clear yes, cancel otherwise.",
      parameters: {
        type: "object",
        properties: { action: { type: "string", enum: ["prepare", "confirm", "cancel"] }, itemName: { type: "string" } },
        required: ["action"], additionalProperties: false,
      },
    },
  ] as const;
}

// ---- Runner (called from components/owner-voice-session.tsx) -------------------------------------

export type ItemRunContext = { getToken: () => Promise<string>; goTo: (path: string) => void; gate: TeamGate; signal: AbortSignal };

const text = (value: unknown) => (typeof value === "string" ? value.trim() : undefined);

export async function runOwnerItemTool(name: OwnerItemToolName, rawArguments: string, context: ItemRunContext): Promise<VoiceResult> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}") as Record<string, unknown>; } catch { return { status: "REJECTED", message: "Send valid arguments." }; }
  const { gate } = context;

  if (name === LIST_ITEMS_TOOL) {
    const search = text(args.search) ?? "";
    const response = await fetch("/api/items", {
      headers: { Authorization: `Bearer ${await context.getToken()}` }, cache: "no-store",
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(15_000)]),
    });
    const data = await response.json().catch(() => null) as { items?: Parameters<typeof summarizeItems>[0] } | null;
    if (!response.ok || !Array.isArray(data?.items)) return { status: "UNAVAILABLE", message: "Could not load the Item list." };
    itemsPageVoice.current()?.setSearch(search); // the open page shows the same results
    return summarizeItems(data.items, search);
  }

  if (name === OPEN_ADD_ITEM_TOOL || name === OPEN_EDIT_ITEM_TOOL) {
    const itemName = text(args.itemName) ?? "";
    if (name === OPEN_EDIT_ITEM_TOOL && !itemName) return { status: "REJECTED", message: "Ask which item, then send itemName." };
    context.goTo(ITEMS_PAGE);
    clear(gate);
    return itemsPageVoice.run((page) => (name === OPEN_ADD_ITEM_TOOL ? page.openAdd() : page.openEdit(itemName)));
  }

  if (name === ITEM_FORM_TOOL) {
    const action = text(args.action) ?? "";
    if (!(ITEM_FORM_ACTIONS as readonly string[]).includes(action)) {
      return { status: "REJECTED", message: `action must be one of: ${ITEM_FORM_ACTIONS.join(", ")}.` };
    }
    if (args.priceAud !== undefined && (typeof args.priceAud !== "number" || !Number.isFinite(args.priceAud) || args.priceAud < 0)) {
      return { status: "INVALID", message: "The price must be a number of dollars, 0 or more." };
    }
    if (action === "save") {
      const refusal = blocked(gate, (kind) => kind === "item_save");
      if (refusal) return refusal;
    }
    const result = await itemFormVoice.run((form) => form.step({
      action: action as ItemFormArgs["action"],
      ...(text(args.name) !== undefined ? { name: text(args.name) } : {}),
      ...(typeof args.priceAud === "number" ? { priceAud: Math.round(args.priceAud * 100) / 100 } : {}),
      ...(text(args.code) !== undefined ? { code: text(args.code) } : {}),
      ...(text(args.description) !== undefined ? { description: text(args.description) } : {}),
      ...(text(args.section) !== undefined ? { section: text(args.section) as ItemFormArgs["section"] } : {}),
    }), 3_000);
    if (result.status === "REVIEW") ask(gate, "item_save");
    if (action === "fill" && result.status === "OK" && gate.kind === "item_save") clear(gate); // changed after the read-back
    if (result.status === "SAVED") clear(gate);
    return result;
  }

  // delete_item
  const action = text(args.action);
  if (action === "confirm") {
    const refusal = blocked(gate, (kind) => kind === "item_delete");
    if (refusal) return refusal;
    const result = await itemsPageVoice.run((page) => page.confirmDelete(), 1_000);
    if (result.status === "DONE") clear(gate);
    return result;
  }
  if (action === "cancel") {
    clear(gate);
    return itemsPageVoice.run((page) => page.cancel(), 1_000);
  }
  if (action !== "prepare") return { status: "REJECTED", message: "action must be prepare, confirm or cancel." };
  const itemName = text(args.itemName) ?? "";
  if (!itemName) return { status: "REJECTED", message: "Ask which item, then send itemName." };
  context.goTo(ITEMS_PAGE);
  clear(gate);
  const result = await itemsPageVoice.run((page) => page.prepareDelete(itemName));
  if (result.status === "CONFIRM") ask(gate, "item_delete");
  return result;
}
