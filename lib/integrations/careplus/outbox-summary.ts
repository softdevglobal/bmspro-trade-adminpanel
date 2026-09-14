import type { CareplusOutboxRecord } from "@/lib/integrations/careplus/types";

export function summarizeCareplusOutbox(rows: CareplusOutboxRecord[]): {
  pending: number;
  awaiting: number;
  applied: number;
  rejected: number;
} {
  return rows.reduce(
    (counts, row) => {
      if (row.status === "pending" || row.status === "retry") counts.pending += 1;
      if (
        row.status === "awaiting_receipt" ||
        row.processingStatus === "pending_mapping" ||
        row.processingStatus === "accepted" ||
        row.processingStatus === "received"
      ) {
        counts.awaiting += 1;
      }
      if (
        row.processingStatus === "applied" ||
        row.processingStatus === "pending_review" ||
        row.processingStatus === "processed"
      ) {
        counts.applied += 1;
      }
      if (
        row.status === "failed" ||
        row.processingStatus === "rejected" ||
        row.processingStatus === "correction_required"
      ) {
        counts.rejected += 1;
      }
      return counts;
    },
    { pending: 0, awaiting: 0, applied: 0, rejected: 0 },
  );
}
