export const BUSINESS_CLOSURES_COLLECTION = "business_closures";

export type BusinessClosure = {
  id: string;
  businessId: string;
  date: string;
  reason: string | null;
  createdByUid: string;
  createdAt: string | null;
};

export type ClosureConflictItem = {
  id: string;
  kind: "job" | "request";
  title: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  reference: string;
  timeLabel: string;
};

export function parseCreateBusinessClosureInput(raw: unknown):
  | { ok: true; value: { date: string; reason: string | null; acknowledgedConflicts: boolean } }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, error: "Enter a valid date." };
  }

  const reason =
    typeof input.reason === "string" && input.reason.trim()
      ? input.reason.trim().slice(0, 500)
      : null;

  return {
    ok: true,
    value: {
      date,
      reason,
      acknowledgedConflicts: input.acknowledgedConflicts === true,
    },
  };
}
