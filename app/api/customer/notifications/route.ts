import { authenticateCustomerRequest } from "@/lib/customer/server";
import {
  deleteAllNotifications,
  listCustomerNotifications,
  markAllNotificationsRead,
} from "@/lib/notifications/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  const notifications = await listCustomerNotifications(
    auth.customer.uid,
    auth.customer.email,
  );
  return NextResponse.json({ ok: true, notifications });
}

/** Mark all of the customer's notifications as read. */
export async function PATCH(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await markAllNotificationsRead({
    audience: "customer",
    customerId: auth.customer.uid,
    customerEmail: auth.customer.email,
  });
  return NextResponse.json({ ok: true });
}

/** Clear all of the customer's notifications. */
export async function DELETE(request: Request) {
  const auth = await authenticateCustomerRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }
  await deleteAllNotifications({
    audience: "customer",
    customerId: auth.customer.uid,
    customerEmail: auth.customer.email,
  });
  return NextResponse.json({ ok: true });
}
