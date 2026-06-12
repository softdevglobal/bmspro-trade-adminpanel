import type { InspectionRequestDetail } from "@/lib/inspection/types";

/** Incoming customer requests that still need owner review. */
export function countPendingInspectionRequests(
  requests: InspectionRequestDetail[],
): number {
  return requests.filter((request) => request.status === "pending").length;
}
