/**
 * Voice add / edit customer, browser side. Sophie drives the Add / Edit customer popup on the owner's
 * screen with these tools (they run in components/owner-voice-session.tsx, not on the server):
 *
 *   open_add_customer_form    goes to Customers and opens the Add customer popup
 *   open_edit_customer_form   opens the Edit popup for one customer (by name, email or phone)
 *   customer_form_step        fill / continue / back / save in the open popup
 *   list_customers            searches the owner's customers (read-only)
 *
 * The server twin (no screen) is lib/ai/owner-call/owner-customer-actions.ts (MCP tools).
 * Pure: no server-only imports.
 */
import { CUSTOMER_FORM_LIMITS } from "@/lib/customer/form";

export const OPEN_ADD_CUSTOMER_TOOL_NAME = "open_add_customer_form";
export const OPEN_EDIT_CUSTOMER_TOOL_NAME = "open_edit_customer_form";
export const CUSTOMER_FORM_STEP_TOOL_NAME = "customer_form_step";
export const LIST_CUSTOMERS_TOOL_NAME = "list_customers";
export const CUSTOMERS_PAGE = "/dashboard/customers";

/** Browser event: a mounted Customers page opens its popup. */
export const OPEN_CUSTOMER_FORM_EVENT = "trade:open-customer-form";

export type OpenCustomerRequest = { mode: "add" } | { mode: "edit"; customerId: string };
let pendingOpen: OpenCustomerRequest | null = null; // survives the page navigation

/** Asks the Customers page to open its popup (now if mounted, otherwise when it mounts). */
export function requestOpenCustomerForm(request: OpenCustomerRequest) {
  pendingOpen = request;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_CUSTOMER_FORM_EVENT));
}

/** Returns the pending request once, so the popup opens a single time. */
export function consumeOpenCustomerForm(): OpenCustomerRequest | null {
  const request = pendingOpen;
  pendingOpen = null;
  return request;
}

export type CustomerFormStepArgs = {
  action: "fill" | "continue" | "back" | "save";
  fullName?: string;
  email?: string;
  phone?: string;
  company?: string;
  notes?: string;
  address?: { street?: string; suburb?: string; state?: string; postcode?: string };
  sendInvite?: boolean;
};
export type CustomerStepResult = { status: string; message: string };
type CustomerStepHandler = (args: CustomerFormStepArgs) => CustomerStepResult | Promise<CustomerStepResult>;
let stepHandler: CustomerStepHandler | null = null; // set by the open popup

/** The popup registers itself while open. Returns an unregister function. */
export function registerCustomerStepHandler(handler: CustomerStepHandler) {
  stepHandler = handler;
  return () => { if (stepHandler === handler) stepHandler = null; };
}

/** Fills fields, then presses Continue, Back or Save in the open popup. */
export async function runCustomerFormStep(args: CustomerFormStepArgs): Promise<CustomerStepResult> {
  if (!stepHandler) {
    return { status: "NOT_OPEN", message: "The customer popup is not open. Call open_add_customer_form or open_edit_customer_form first." };
  }
  return stepHandler(args);
}

const L = CUSTOMER_FORM_LIMITS;

/** Realtime tool definitions (JSON Schema). They run in the owner's browser. */
export function ownerCustomerBrowserTools() {
  return [
    {
      type: "function",
      name: LIST_CUSTOMERS_TOOL_NAME,
      description:
        "Search the business's customers by name, email or phone (read-only). Use it to check whether someone already exists before adding them, " +
        "or to find the customer to edit. Never read out full phone numbers or emails unless the owner asks.",
      parameters: {
        type: "object",
        properties: { search: { type: "string", maxLength: 120, description: "Part of a name, email or phone" } },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: OPEN_ADD_CUSTOMER_TOOL_NAME,
      description:
        "Go to the Customers page and open the Add customer popup on the owner's screen. Use it as soon as the owner asks to add or create a customer. " +
        "Then ask for the details one short question at a time (name, mobile, email) and fill them with customer_form_step.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      type: "function",
      name: OPEN_EDIT_CUSTOMER_TOOL_NAME,
      description:
        "Open the Edit customer popup for one existing customer. Pass search (name, email or phone). If several match, read out the names and ask which one. " +
        "The email cannot be changed because it is the customer's login.",
      parameters: {
        type: "object",
        properties: { search: { type: "string", maxLength: 120 } },
        required: ["search"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: CUSTOMER_FORM_STEP_TOOL_NAME,
      description:
        "Drive the open Add or Edit customer popup like the owner using its fields and buttons. Use it whenever the owner tells you customer details or says to fill, " +
        "change, continue or save. action fill only types the fields you pass; continue goes to the review step (checks the details first, INVALID says what is missing); " +
        "back goes back; save stores the customer, only on the review step and only after you read the name and mobile back, SPELLED OUT the email letter by letter, " +
        "and the owner clearly said yes. Ask one short question at a time. If the result is DUPLICATE, tell the owner who already has that email or phone and do not add them again. " +
        "The invitation email is sent by default; pass sendInvite false only if the owner asks not to email them.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["fill", "continue", "back", "save"] },
          fullName: { type: "string", maxLength: L.nameMax },
          email: { type: "string", maxLength: 254 },
          phone: { type: "string", maxLength: 40, description: "Australian mobile or landline" },
          notes: { type: "string", maxLength: L.notesMax },
          sendInvite: { type: "boolean" },
        },
        required: ["action"],
        additionalProperties: false,
      },
    },
  ] as const;
}

export const OWNER_CUSTOMER_BROWSER_TOOL_NAMES = [
  LIST_CUSTOMERS_TOOL_NAME, OPEN_ADD_CUSTOMER_TOOL_NAME, OPEN_EDIT_CUSTOMER_TOOL_NAME, CUSTOMER_FORM_STEP_TOOL_NAME,
] as const;

/** Feature flag, off unless set. Separate from the other areas so it can be switched off alone. */
export function ownerCustomersEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env.AI_OWNER_VOICE_CUSTOMERS_ENABLED === "true";
}

/** One short line for Sophie's instructions (they are capped at 4,000 characters). Detail lives in the tool descriptions. */
export const OWNER_CUSTOMER_INSTRUCTIONS =
  "To add or edit a customer use the customer tools and follow their instructions.";

/** Finds customers for list_customers and open_edit_customer_form. Pure so it is unit tested. */
export function searchCustomers<T extends { fullName: string; email: string; phone: string }>(
  customers: readonly T[],
  search: string,
  limit = 5,
): T[] {
  const q = search.trim().toLowerCase();
  if (!q) return customers.slice(0, limit);
  // Compare phones without +61 / 0 so "0412…", "+61 412…" and "412…" all match.
  const local = (value: string) => value.replace(/\D/g, "").replace(/^(0061|61|0+)/, "");
  const digits = local(q);
  return customers
    .filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (digits.length >= 4 && local(c.phone).includes(digits)))
    .slice(0, limit);
}
