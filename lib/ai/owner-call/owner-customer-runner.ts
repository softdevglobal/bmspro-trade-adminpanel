/**
 * Runs the browser customer tools for Talk to Sophie (see owner-customer.ts for what each does).
 * Called from components/owner-voice-session.tsx. A saved change needs the owner's reply after the
 * read-back, checked here with the same gate as the other owner tools (checkOwnerReply).
 */
import {
  CUSTOMER_FORM_STEP_TOOL_NAME,
  CUSTOMERS_PAGE,
  LIST_CUSTOMERS_TOOL_NAME,
  OPEN_ADD_CUSTOMER_TOOL_NAME,
  OPEN_EDIT_CUSTOMER_TOOL_NAME,
  OWNER_CUSTOMER_BROWSER_TOOL_NAMES,
  requestOpenCustomerForm,
  runCustomerFormStep,
  searchCustomers,
  type CustomerFormStepArgs,
} from "./owner-customer";
import { checkOwnerReply } from "./owner-service";
import type { TeamGate } from "./owner-team-runner";
import type { CustomerProfile } from "@/lib/customer/types";

export function isOwnerCustomerTool(name: string): boolean {
  return (OWNER_CUSTOMER_BROWSER_TOOL_NAMES as readonly string[]).includes(name);
}

export type CustomerRunContext = {
  getToken: () => Promise<string>;
  /** Navigates to the Customers page unless it is already open. */
  goTo: (path: string) => void;
  gate: TeamGate;
  signal: AbortSignal;
};

const ACTIONS = ["fill", "continue", "back", "save"];

async function loadCustomers(ctx: CustomerRunContext): Promise<CustomerProfile[] | null> {
  try {
    const response = await fetch("/api/customers", {
      headers: { Authorization: `Bearer ${await ctx.getToken()}` },
      cache: "no-store",
      signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(15_000)]),
    });
    const data = (await response.json().catch(() => null)) as { customers?: CustomerProfile[] } | null;
    return response.ok && Array.isArray(data?.customers) ? data.customers : null;
  } catch {
    return null;
  }
}

const brief = (c: CustomerProfile) => ({ customerId: c.uid, name: c.fullName, email: c.email, phone: c.phone });

export async function runOwnerCustomerTool(name: string, rawArguments: string, ctx: CustomerRunContext): Promise<object> {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArguments || "{}"); } catch { return { status: "REJECTED", message: "Send valid arguments." }; }

  if (name === LIST_CUSTOMERS_TOOL_NAME) {
    const all = await loadCustomers(ctx);
    if (!all) return { status: "UNAVAILABLE", message: "Could not load the customers." };
    const search = typeof args.search === "string" ? args.search : "";
    const found = searchCustomers(all, search, 8);
    return { status: found.length ? "OK" : "NO_MATCH", total: all.length, customers: found.map(brief) };
  }

  if (name === OPEN_ADD_CUSTOMER_TOOL_NAME) {
    ctx.goTo(CUSTOMERS_PAGE);
    requestOpenCustomerForm({ mode: "add" });
    ctx.gate.prepared = false;
    return {
      status: "OPENED",
      message: "The Add customer popup is open. Ask for the name, mobile and email, one short question at a time, then call customer_form_step with action fill.",
    };
  }

  if (name === OPEN_EDIT_CUSTOMER_TOOL_NAME) {
    const search = typeof args.search === "string" ? args.search.trim() : "";
    if (!search) return { status: "REJECTED", message: "Ask which customer to change, then send search." };
    const all = await loadCustomers(ctx);
    if (!all) return { status: "UNAVAILABLE", message: "Could not load the customers." };
    const found = searchCustomers(all, search, 5);
    if (found.length === 0) {
      return { status: "NOT_FOUND", message: "No saved customer matches. Customers who only sent a request cannot be edited here. Ask the owner to check the spelling." };
    }
    if (found.length > 1) {
      return { status: "AMBIGUOUS", customers: found.map((c) => c.fullName), message: "Several customers match. Read out the names and ask which one." };
    }
    ctx.goTo(CUSTOMERS_PAGE);
    requestOpenCustomerForm({ mode: "edit", customerId: found[0].uid });
    ctx.gate.prepared = false;
    return {
      status: "OPENED",
      message: `The Edit popup for ${found[0].fullName} is open. Ask what to change, fill it with customer_form_step, continue to the review step and read it back. The email cannot be changed.`,
    };
  }

  if (name === CUSTOMER_FORM_STEP_TOOL_NAME) {
    if (!ACTIONS.includes(String(args.action))) {
      return { status: "REJECTED", message: `action must be one of: ${ACTIONS.join(", ")}.` };
    }
    const step = args as CustomerFormStepArgs;
    if (step.action === "save") {
      // Held here unless the owner replied to the read-back and did not say no.
      const gate = checkOwnerReply({
        prepared: ctx.gate.prepared,
        ownerTurnsSinceShown: ctx.gate.turns,
        latestOwnerReply: ctx.gate.latestReply,
      });
      if (!gate.ok) {
        return gate.status === "NO_DRAFT"
          ? { status: "NOT_REVIEWED", message: "Continue to the review step, read it back and wait for a clear yes before saving." }
          : { status: gate.status, message: gate.message };
      }
    }
    const result = await runCustomerFormStep(step);
    // A change after the read-back means the owner's earlier yes no longer covers what is on screen.
    if (step.action === "fill" && result.status === "OK") ctx.gate.prepared = false;
    if (result.status === "REVIEW") {
      // A new read-back starts: only replies after this point count.
      Object.assign(ctx.gate, { prepared: true, turns: 0, latestReply: null });
      ctx.gate.replyItems.clear();
    }
    if (result.status === "SAVED") ctx.gate.prepared = false;
    return result;
  }

  return { status: "UNAVAILABLE" };
}
