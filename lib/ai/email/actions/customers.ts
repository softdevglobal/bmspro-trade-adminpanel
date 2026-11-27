import { createHash } from "node:crypto";

import type { InspectionRequestInput } from "@/lib/inspection/types";

import type { ConfirmedDetails } from "../details";
import type { ActionContext, ActionHandler } from "./context";

/**
 * Saving a customer, and adding a site inspection or job request (step 6b). They use only the
 * details the owner confirmed on the card, never what the AI read by itself. A request goes in as a
 * pending custom request: the owner still confirms a time, prices the work or turns it into a job,
 * as with any request. The customer gets the platform's usual "request received" email.
 */

const sender = (context: ActionContext) => String((context.triage.sender as { address?: string } | null)?.address ?? "");
const details = (context: ActionContext) => (context.decision.details ?? null) as ConfirmedDetails | null;

/** A fixed request id per email and kind, so a retried run finds what it already added (T06). */
export function emailRequestId(triageId: string, kind: "inspection_request" | "job_request"): string {
  return createHash("sha256").update(`${triageId}\n${kind}`).digest("hex").slice(0, 20);
}

export const saveCustomer: ActionHandler = {
  async run(context) {
    const confirmed = details(context);
    const email = sender(context);
    if (!confirmed || !email) return { status: "needs_details", summary: "Confirm the customer's details on the card first." };
    try {
      const account = await context.deps.ensureCustomer({
        businessId: context.businessId, email, fullName: confirmed.fullName, phone: confirmed.phone, actorUid: context.actorUid,
      });
      return account.created
        ? {
            status: "done",
            summary: account.welcomeEmailSent
              ? `Saved ${confirmed.fullName} as a customer and emailed them an invite to activate their account.`
              : `Saved ${confirmed.fullName} as a customer, but the invite email could not be sent. Resend it under Customers.`,
          }
        : { status: "skipped", summary: `${confirmed.fullName} is already a customer. Nothing was changed.` };
    } catch {
      return { status: "needs_details", summary: `${email} is already a customer with different details. Check them under Customers.` };
    }
  },
  // No undo: a saved customer is a real account. Remove it under Customers if it was a mistake.
};

function addRequest(kind: "inspection_request" | "job_request"): ActionHandler {
  const what = kind === "job_request" ? "job request" : "site inspection request";
  return {
    async run(context) {
      const request = (context.decision.requestInput ?? null) as InspectionRequestInput | null;
      if (!request) return { status: "needs_details", summary: "Confirm the customer's details and a preferred date on the card first." };
      const requestId = emailRequestId(context.triageId, kind);
      const customerId = await context.deps.findCustomer(context.businessId, request.customer.email);
      const result = await context.deps.createRequest({
        businessId: context.businessId, requestId, request, customerId, triageId: context.triageId, kind,
      });
      if (!result.ok) return { status: "needs_details", summary: `I couldn't add the ${what}: ${result.error}` };
      const code = result.requestCode ? ` ${result.requestCode}` : "";
      return {
        status: "done",
        summary: `Added ${what}${code}. It's pending: you confirm the time, as with any request.`,
        undo: { requestId, code: result.requestCode },
      };
    },
    async undo(context, data) {
      const result = await context.deps.cancelRequest({
        businessId: context.businessId, requestId: String(data.requestId), triageId: context.triageId, actorUid: context.actorUid,
      });
      if (!result.ok) throw new Error(result.reason);
      return `Cancelled the ${what}${data.code ? ` ${String(data.code)}` : ""}.`;
    },
  };
}

export const createInspection = addRequest("inspection_request");
export const createJobRequest = addRequest("job_request");
