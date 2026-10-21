import { requireBusinessMember } from "@/lib/onboarding/server";
import { adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "owner" && auth.role !== "admin") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  const snap = await adminDb.collection("payment_receipts").where("businessId", "==", auth.businessId).get();
  const receipts = snap.docs.filter((doc) => doc.data().reconciliationRequired === true)
    .map((doc) => ({ id: doc.id, targetId: doc.data().targetId, amountAud: doc.data().amountAud,
      reason: doc.data().reconciliationReason, paymentIntentId: doc.data().stripePaymentIntentId }));
  return NextResponse.json({ ok: true, receipts });
}
