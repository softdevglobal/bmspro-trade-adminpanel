export const SMS_LOGS_COLLECTION = "sms_logs";

export type SmsLogStatus = "sent" | "failed" | "skipped";

export type SmsLogEntry = {
  id: string;
  businessId: string | null;
  senderName: string;
  receiverPhone: string;
  receiverName: string | null;
  message: string;
  status: SmsLogStatus;
  statusDetail: string | null;
  source: string | null;
  createdAt: number | null;
};

export type AppendSmsLogInput = {
  businessId?: string | null;
  senderName?: string | null;
  receiverPhone: string;
  receiverName?: string | null;
  message: string;
  status: SmsLogStatus;
  statusDetail?: string | null;
  source?: string | null;
};
