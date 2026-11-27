import "server-only";

import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";

import type { CustomerIntent } from "@/lib/ai/email/types";
import type { BusinessMailContext } from "@/lib/email-integration/mailbox/directory";
import type { MailboxCustomerContext } from "@/lib/email-integration/types";
import { displayBookingCode, displayQuotationCode } from "@/lib/reference-codes";

/**
 * What a business has with one customer: quotes, invoices, jobs and site inspections
 * (docs/sophie-email-learning-and-auto-reply.md §9.4). Shared by the owner's mailbox panel
 * (GET /api/email/mailbox/customer) and Sophie, so both read the same records. Code builds it, never
 * the AI, and only for an address that is this business's customer.
 */

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

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

/** Newest first, at most `take`. */
function newest<T extends { date: number | null }>(items: T[], take: number): T[] {
  return items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, take);
}

type Docs = { id: string; data: DocumentData }[];

/** Pure: the context from the four record lists. */
export function buildCustomerContext(
  email: string,
  names: ReadonlySet<string> | undefined,
  records: { quotes: Docs; invoices: Docs; jobs: Docs; inspections: Docs },
): MailboxCustomerContext {
  const { quotes, invoices, jobs, inspections } = records;
  const first = [...quotes, ...invoices, ...jobs, ...inspections][0]?.data.customer ?? {};
  return {
    email,
    name: [...(names ?? [])][0] ?? (text(first.fullName) || null),
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
}

async function byCustomer(db: Firestore, collection: string, businessId: string, email: string): Promise<Docs> {
  // Equality-only filters: served by Firestore's single-field indexes.
  const snap = await db
    .collection(collection)
    .where("businessId", "==", businessId)
    .where("customer.email", "==", email)
    .limit(LIMIT)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as DocumentData }))
    .filter((doc) => doc.data.businessId === businessId);
}

/** The context, or null when the address isn't this business's customer. */
export async function loadCustomerContext(
  db: Firestore,
  businessId: string,
  rawEmail: string,
  mail: Pick<BusinessMailContext, "customers">,
): Promise<MailboxCustomerContext | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !mail.customers.has(email)) return null;
  const [quotes, invoices, jobs, inspections] = await Promise.all([
    byCustomer(db, "quotations", businessId, email),
    byCustomer(db, "invoices", businessId, email),
    byCustomer(db, "jobs", businessId, email),
    byCustomer(db, "requests", businessId, email),
  ]);
  return buildCustomerContext(email, mail.customers.get(email), { quotes, invoices, jobs, inspections });
}

const MAX_RECORDS = 5;
const OPEN_JOB = new Set(["awaiting", "scheduled", "ongoing"]);
const OPEN_REQUEST = new Set(["pending", "scheduled"]);

/**
 * Only the fields each question may see (§9.4), at most 5 records. Never amounts: money only reaches
 * a customer through the platform's own invoice email (§9.3, T2). The owner's card shows everything.
 */
export function recordsForIntent(
  context: MailboxCustomerContext,
  intent: CustomerIntent,
): { records: Record<string, { code: string; status?: string; date?: number | null; id?: string }[]>; omitted: string[] } {
  const all = ["quotes", "invoices", "jobs", "inspections"];
  const pick = (records: Record<string, { code: string; status?: string; date?: number | null; id?: string }[]>) => {
    const kept = Object.fromEntries(Object.entries(records).map(([key, list]) => [key, list.slice(0, MAX_RECORDS)]));
    return { records: kept, omitted: all.filter((key) => !(key in kept)) };
  };
  const soonest = <T extends { date: number | null }>(list: T[]) => [...list].sort((a, b) => (a.date ?? 0) - (b.date ?? 0));
  switch (intent) {
    case "booking_status":
    case "booking_change": {
      const upcoming = soonest([
        ...context.jobs.filter((job) => OPEN_JOB.has(job.status)),
        ...context.inspections.filter((item) => OPEN_REQUEST.has(item.status)),
      ]).slice(0, 3).map(({ code, status, date }) => ({ code, status, date }));
      return pick({ upcoming });
    }
    case "request_status":
      return pick({ inspections: context.inspections.map(({ code, status, date }) => ({ code, status, date })) });
    case "quote_status":
      return pick({ quotes: context.quotes.map(({ code, status, date }) => ({ code, status, date })) });
    case "document_request":
      return pick({
        quotes: context.quotes.map(({ id, code }) => ({ id, code })),
        invoices: context.invoices.map(({ id, code }) => ({ id, code })),
      });
    case "repeat_fault":
    case "history_question":
      return pick({ completedJobs: context.jobs.filter((job) => job.status === "completed").map(({ code, date }) => ({ code, date })) });
    default:
      return { records: {}, omitted: all };
  }
}
