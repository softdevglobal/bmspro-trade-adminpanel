import { NextResponse } from "next/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { adminDb } from "@/lib/firebase/admin";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const uid = new URL(request.url).searchParams.get("customerId");
  if (!uid || uid.includes("/")) return NextResponse.json({ error: "Invalid customer." }, { status: 400 });
  const customer = await adminDb.collection("customers").doc(uid).get();
  if (!customer.exists || customer.get("registeredBusinessId") !== auth.businessId) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const key = (value: string) => { let d = value.replace(/\D/g, ""); if(d.startsWith("0061")) d=d.slice(2); if(d.startsWith("61") && d.length>=10) d=`0${d.slice(2)}`; return d; };
  try {
    const snapshot = await adminDb.collection("jobs").where("businessId", "==", auth.businessId).get();
    const phone = key(customer.get("phone") || "");
    const bookings = snapshot.docs.filter(doc => doc.get("customerId") === uid || (phone && key(doc.get("customer.phone") || "") === phone)).map(doc => {
      const d = doc.data();
      return { id: doc.id, code: d.bookingCode || doc.id, service: d.serviceName || d.customRequest?.title || "Booking", status: d.status || "awaiting", date: d.scheduledSlot?.date || null, address: d.address?.street || "" };
    }).sort((a,b) => (b.date || "").localeCompare(a.date || ""));
    return NextResponse.json({ bookings }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Could not load booking history." }, { status: 500 }); }
}
