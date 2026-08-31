/**
 * One current status and one next action per request card.
 *
 * Request cards used to stack every stage pill at once (pending, completed,
 * awaiting decision, awaiting job, awaiting customer), which left staff with
 * no idea what to actually do next. This resolves the request down to a single
 * status line plus the one action that moves it forward.
 */

import type { StatusTone } from "@/lib/copy/product-language";
import type { InspectionRequestDetail } from "@/lib/inspection/types";

export type RequestCardStatus = {
  /** The single status shown on the card. */
  label: string;
  tone: StatusTone;
  /** The one thing staff should do next, or null when nothing is pending. */
  nextStep: string | null;
};

/**
 * Resolves the request's current stage, most-terminal first, so only one
 * status can ever win.
 */
export function resolveRequestCardStatus(
  request: InspectionRequestDetail,
): RequestCardStatus {
  if (request.status === "cancelled") {
    return { label: "Cancelled", tone: "red", nextStep: null };
  }

  const quotation = request.quotation;
  const quotationLive =
    !!quotation && quotation.status !== "cancelled";

  // A rejected quote needs attention before anything else on the card.
  if (quotationLive && quotation.customerDecision === "rejected") {
    return {
      label: "Quote rejected",
      tone: "red",
      nextStep: "Follow up with the customer",
    };
  }

  if (request.status === "completed") {
    // Completed inspections still have downstream work worth surfacing.
    if (quotationLive && quotation.customerDecision !== "accepted") {
      return {
        label: "Waiting for customer",
        tone: "amber",
        nextStep: "Waiting on the quote decision",
      };
    }
    if (quotationLive && !request.bookingId) {
      return {
        label: "Quote accepted",
        tone: "blue",
        nextStep: "Schedule job",
      };
    }
    if (!quotationLive) {
      return {
        label: "Inspection complete",
        tone: "blue",
        nextStep: "Send quote",
      };
    }
    return { label: "Completed", tone: "grey", nextStep: null };
  }

  if (request.status === "awaiting_decision") {
    return {
      label: "Waiting for customer",
      tone: "amber",
      nextStep: "Waiting on the customer's decision",
    };
  }

  if (request.status === "scheduled") {
    if (!request.assignedTo) {
      return {
        label: "Inspection confirmed",
        tone: "green",
        nextStep: "Assign an inspector",
      };
    }
    return {
      label: "Inspection confirmed",
      tone: "green",
      nextStep: "Carry out the inspection",
    };
  }

  if (request.status === "owner_proposed") {
    return {
      label: "Waiting for customer",
      tone: "amber",
      nextStep: "Waiting on the customer to accept a time",
    };
  }

  // pending
  return {
    label: "New request",
    tone: "blue",
    nextStep: "Confirm inspection time",
  };
}
