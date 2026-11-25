import "server-only";
import { normalizeInvoiceCallbackNumber } from "./callback-number";

export function ownerInspectionCallAllowed(row: Record<string, unknown>, binding: {businessId:string;did:string}, number: string | null, now=Date.now()) {
  const phone=number && normalizeInvoiceCallbackNumber(number);
  return !!phone && row.purpose === "owner_notification" && ["CALLING","ANSWERED"].includes(String(row.status)) && !row.callLogId &&
    row.businessId === binding.businessId && row.did === binding.did && row.number === phone &&
    typeof row.attemptedAt === "number" && row.attemptedAt <= now && now-row.attemptedAt < 15*60000 &&
    typeof row.expiresAt === "number" && row.expiresAt > now;
}

export async function authorizeOwnerNotificationRead(binding:{businessId:string;did:string}, attemptId:string, number:string|null) {
  const [{adminDb},{validateDueOwnerNotification}] = await Promise.all([
    import("@/lib/firebase/admin"),import("./owner-notifications"),
  ]);
  const row=(await adminDb.collection("ai_scheduled_callbacks").doc(attemptId).get()).data();
  if (!row || !ownerInspectionCallAllowed(row,binding,number)) return null;
  const business=(await adminDb.collection("businesses").doc(binding.businessId).get()).data();
  if (!business || await validateDueOwnerNotification(row,business.ownerUid)) return null;
  return {row,business};
}

export async function readOwnerInspectionDetails(binding:{businessId:string;did:string}, attemptId:string, number:string|null) {
  const authorized=await authorizeOwnerNotificationRead(binding,attemptId,number);
  if (!authorized) return null;
  const {row,business}=authorized;
  const [{adminDb},{mapInspectionDoc}]=await Promise.all([import("@/lib/firebase/admin"),import("@/lib/inspection/map-inspection-doc")]);
  const snapshot=await adminDb.collection("requests").doc(String(row.requestId)).get();
  const data=snapshot.data();
  if (!data || data.businessId !== binding.businessId || data.requestCode !== row.requestCode) return null;
  const detail=mapInspectionDoc(snapshot.id,data);
  // Explicit projection: no images, account identifiers, internal notes, invoices
  // or other customer/inspection records are returned to the voice model.
  return {requestCode:detail.requestCode,status:detail.status,requestType:detail.requestType,
    service:detail.serviceName,scope:detail.customRequest,customerName:detail.customer.fullName,
    address:detail.address,preferredSlots:detail.preferredSlots,scheduledSlot:detail.scheduledSlot,
    scheduledStartTime:detail.scheduledStartTime,scheduledEndTime:detail.scheduledEndTime,
    customerNotes:detail.customerNotes,timezone:business.timezone||"Australia/Melbourne"};
}
