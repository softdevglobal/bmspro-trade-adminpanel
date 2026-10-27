import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { sendEmail } from "@/lib/email/zeptomail";
import { sendSms } from "@/lib/sms/textbee";
import { renderSophieOwnerEmail } from "@/lib/sophieOwnerEmail";

/** Best-effort email and SMS to the business owner after a Sophie inspection action. */
export async function sendSophieInspectionOwnerAlert(input: {
  businessId: string;
  requestCode: string;
  customerName: string;
  serviceName: string;
  status: "scheduled" | "pending";
  date?: string | null;
  timeRange?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  staffName?: string | null;
}) {
  try {
    const businessSnap = await adminDb.collection("businesses").doc(input.businessId).get();
    const business = businessSnap.data() ?? {};
    const ownerUid = typeof business.ownerUid === "string" ? business.ownerUid.trim() : "";
    const ownerSnap = ownerUid ? await adminDb.collection("users").doc(ownerUid).get() : null;
    const owner = ownerSnap?.data() ?? {};
    const email = [owner.email, owner.ownerEmail, business.ownerEmail, business.businessEmail]
      .find(value => typeof value === "string" && value.trim()) as string | undefined;
    const phone = [owner.phone, owner.phoneNumber, owner.mobile, owner.contactPhone, business.ownerPhone, business.businessPhone]
      .find(value => typeof value === "string" && value.trim()) as string | undefined;
    const confirmed = input.status === "scheduled";
    const title = confirmed ? "Sophie scheduled an inspection" : "Sophie created an inspection request";
    const tasks: Promise<unknown>[] = [];
    if (email) {
      tasks.push(sendEmail({
        sender: "sophie",
        to: email,
        toName: typeof owner.name === "string" ? owner.name : undefined,
        subject: `${title} · ${input.requestCode}`,
        htmlBody: renderSophieOwnerEmail({
          product: "trade",
          confirmed,
          reference: input.requestCode,
          ownerName: owner.name || owner.fullName || owner.displayName,
          businessName: business.businessName,
          customerName: input.customerName,
          serviceNames: [input.serviceName || "Inspection"],
          date: input.date,
          time: input.startTime && input.endTime ? `${input.startTime}–${input.endTime}` : input.timeRange,
          staffNames: input.staffName ? [input.staffName] : [],
        }),
      }));
    }
    if (phone) {
      tasks.push(sendSms({
        to: phone,
        businessId: input.businessId,
        source: "sophie_inspection_owner_alert",
        senderName: "BMS Pro Trade",
        receiverName: typeof owner.name === "string" ? owner.name : "Business owner",
        message: `${title}. ${input.requestCode}: ${input.customerName}, ${input.serviceName || "Inspection"}${input.date ? `, ${input.date} ${input.timeRange || ""}` : ""}${input.startTime && input.endTime ? ` ${input.startTime}–${input.endTime}` : ""}. ${confirmed ? `Staff: ${input.staffName || "assigned"}.` : "Please review the request."}`,
      }));
    }
    const results = await Promise.allSettled(tasks);
    if (results.some(result => result.status === "rejected")) {
      console.error("[sophie-owner-alert] One or more owner notifications failed.", { requestCode: input.requestCode });
    }
    if (!email && !phone) console.warn("[sophie-owner-alert] No owner email or phone was found.", { businessId: input.businessId });
  } catch (error) {
    console.error("[sophie-owner-alert] Could not send owner alert.", { requestCode: input.requestCode, error });
  }
}
