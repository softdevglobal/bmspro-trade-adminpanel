import { authenticateCustomerRequest } from "@/lib/customer/server";
import {
  deleteNotification,
  markNotificationRead,
} from "@/lib/notifications/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url);
  const bookingSlug = url.searchParams.get("bookingSlug")?.trim() || undefined;
  const auth = await authenticateCustomerRequest(request, { bookingSlug });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;
  const ok = await markNotificationRead(id, {
    audience: "customer",
    customerId: auth.customer.uid,
    customerEmail: auth.customer.email,
    businessId: auth.customer.businessId,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/** Clear a single notification for the customer. */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const url = new URL(request.url);
  const bookingSlug = url.searchParams.get("bookingSlug")?.trim() || undefined;
  const auth = await authenticateCustomerRequest(request, { bookingSlug });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const { id } = await context.params;
  const ok = await deleteNotification(id, {
    audience: "customer",
    customerId: auth.customer.uid,
    customerEmail: auth.customer.email,
    businessId: auth.customer.businessId,
  });
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Notification not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
