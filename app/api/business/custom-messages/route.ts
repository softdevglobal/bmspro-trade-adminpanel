import { listInspectionRequests } from "@/lib/inspection/server";
import type { InspectionRequestDetail } from "@/lib/inspection/types";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { getBusinessSmsBalance } from "@/lib/sms-packages/server";
import { sendBulkSms, toE164 } from "@/lib/sms/textbee";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_MESSAGE_LENGTH = 480;

type CustomerContact = {
  id: string;
  fullName: string;
  phone: string;
};

/** Stable key for a customer, matching the customers board grouping. */
function customerKey(request: InspectionRequestDetail): string {
  const email = request.customer.email?.trim().toLowerCase();
  if (email) return `email:${email}`;
  const phone = request.customer.phone?.replace(/\D/g, "");
  if (phone) return `phone:${phone}`;
  return `name:${request.customer.fullName.trim().toLowerCase()}`;
}

/** Builds the deduped list of customers that have a usable phone number. */
function buildCustomerContacts(
  requests: InspectionRequestDetail[],
): CustomerContact[] {
  const map = new Map<string, CustomerContact>();

  for (const request of requests) {
    const phone = request.customer.phone?.trim();
    if (!phone || !toE164(phone)) continue;

    const key = customerKey(request);
    const existing = map.get(key);
    if (existing) {
      if (!existing.fullName && request.customer.fullName) {
        existing.fullName = request.customer.fullName.trim();
      }
      continue;
    }

    map.set(key, {
      id: key,
      fullName: request.customer.fullName?.trim() || "Unknown customer",
      phone,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName),
  );
}

/** Business owner — customers reachable by SMS + current credit balance. */
export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const [requests, balance] = await Promise.all([
    listInspectionRequests(auth.businessId),
    getBusinessSmsBalance(auth.businessId),
  ]);

  return NextResponse.json({
    ok: true,
    customers: buildCustomerContacts(requests),
    balance,
  });
}

/** Business owner — send a custom SMS to selected customers (or all). */
export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = (body ?? {}) as {
    message?: unknown;
    recipients?: unknown;
    phones?: unknown;
  };

  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Write a message to send." },
      { status: 400 },
    );
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      {
        ok: false,
        error: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters).`,
      },
      { status: 400 },
    );
  }

  const requests = await listInspectionRequests(auth.businessId);
  const contacts = buildCustomerContacts(requests);

  let selected: CustomerContact[];
  if (payload.recipients === "all") {
    selected = contacts;
  } else if (Array.isArray(payload.recipients)) {
    const ids = new Set(
      payload.recipients.filter((id): id is string => typeof id === "string"),
    );
    selected = contacts.filter((contact) => ids.has(contact.id));
  } else if (Array.isArray(payload.phones)) {
    const normalized = new Set(
      payload.phones
        .filter((phone): phone is string => typeof phone === "string")
        .map((phone) => toE164(phone.trim()))
        .filter((phone): phone is string => !!phone),
    );
    selected = contacts.filter((contact) => {
      const e164 = toE164(contact.phone);
      return e164 ? normalized.has(e164) : false;
    });
  } else {
    return NextResponse.json(
      { ok: false, error: 'Choose "all" or select customers to message.' },
      { status: 400 },
    );
  }

  if (selected.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No customers with a valid phone number selected." },
      { status: 400 },
    );
  }

  const sentCount = await sendBulkSms(
    selected.map((contact) => contact.phone),
    message,
    auth.businessId,
  );

  if (sentCount === 0) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not send messages. Check your SMS balance and try again.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    sentCount,
    requestedCount: selected.length,
  });
}
