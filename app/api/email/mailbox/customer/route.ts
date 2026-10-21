/**
 * GET ?email= — what this business has with a customer: quotes, invoices,
 * jobs and site inspections. Only for addresses that are this business's
 * customers; never reveals another business's records.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import { loadBusinessMailContext } from "@/lib/email-integration/mailbox/directory";
import type { MailboxCustomerContext } from "@/lib/email-integration/types";
import { adminDb } from "@/lib/firebase/admin";
import { displayBookingCode, displayQuotationCode } from "@/lib/reference-codes";
import { Timestamp, type DocumentData } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 30;

function millis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Newest first, at most `take`. */
function newest<T extends { date: number | null }>(items: T[], take: number): T[] {
  return items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, take);
}

async function byCustomer(collection: string, businessId: string, email: string) {
  // Equality-only filters: served by Firestore's single-field indexes.
  const snap = await adminDb
    .collection(collection)
    .where("businessId", "==", businessId)
    .where("customer.email", "==", email)
    .limit(LIMIT)
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as DocumentData }));
}

export async function GET(request: Request) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email || email.length > 320) return emailError(400, "Email is required.");

  const mail = await loadBusinessMailContext(auth.businessId);
  if (!mail.customers.has(email)) return emailError(404, "Not a customer of this business.");

  const [quotes, invoices, jobs, inspections] = await Promise.all([
    byCustomer("quotations", auth.businessId, email),
    byCustomer("invoices", auth.businessId, email),
    byCustomer("jobs", auth.businessId, email),
    byCustomer("requests", auth.businessId, email),
  ]);

  const first = [...quotes, ...invoices, ...jobs, ...inspections][0]?.data.customer ?? {};
  const context: MailboxCustomerContext = {
    email,
    name: [...(mail.customers.get(email) ?? [])][0] ?? (text(first.fullName) || null),
    phone: text(first.phone) || null,
    quotes: newest(
      quotes.map(({ id, data }) => ({
        id,
        code: displayQuotationCode({
          id,
          quotationCode: text(data.quotationCode) || null,
          inspectionRequestId: text(data.inspectionRequestId) || undefined,
        }),
        status: data.customerDecision === "accepted" ? "accepted" : data.customerDecision === "rejected" ? "declined" : text(data.status) || "draft",
        amountAud: amount(data.finalPriceAud),
        date: millis(data.createdAt),
      })),
      8,
    ),
    invoices: newest(
      invoices.map(({ id, data }) => ({
        id,
        code: text(data.invoiceCode) || "Invoice",
        status: text(data.status) || "draft",
        amountAud: data.status === "paid" ? amount(data.finalPriceAud) : amount(data.balanceDueAud ?? data.finalPriceAud),
        date: millis(data.createdAt),
      })),
      8,
    ),
    jobs: newest(
      jobs.map(({ id, data }) => ({
        id,
        code: displayBookingCode({ id, bookingCode: text(data.bookingCode) || null }),
        status: text(data.status) || "scheduled",
        date: millis(data.scheduledAt ?? data.date ?? data.createdAt),
      })),
      8,
    ),
    inspections: newest(
      inspections.map(({ id, data }) => ({
        id,
        code: text(data.requestCode) || "Site inspection",
        status: text(data.status) || "pending",
        date: millis(data.createdAt),
      })),
      5,
    ),
  };
  return NextResponse.json({ ok: true, customer: context });
}
