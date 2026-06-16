export type LeaveStatus = "pending" | "approved" | "rejected";

export type LeaveRequestRecord = {
  id: string;
  businessId: string | null;
  ownerUid: string | null;
  requesterUid: string;
  requesterName: string;
  requesterRole: string | null;
  /** Local (platform timezone) calendar day, YYYY-MM-DD. */
  fromDate: string | null;
  toDate: string | null;
  fromMillis: number | null;
  toMillis: number | null;
  isFullDay: boolean;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  attachmentUrl: string | null;
  status: LeaveStatus;
  rejectionReason: string | null;
  createdAtIso: string | null;
  createdAtMillis: number | null;
};
