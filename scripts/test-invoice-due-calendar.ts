/**
 * Unit tests for invoice due dates on the calendar.
 *
 * Run: npm run test:invoice-due-calendar
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildInvoiceDueCalendarEvents } from "../lib/calendar/events";
import {
  invoiceDueHref,
  invoiceDueItems,
  totalOutstandingAud,
} from "../lib/invoices/calendar-due";
import type { InvoiceDetail } from "../lib/invoices/types";

const NOW = new Date("2026-11-26T01:00:00Z"); // 26 Nov 2026, midday in Sydney
const TZ = "Australia/Sydney";

function invoice(overrides: Partial<InvoiceDetail>): InvoiceDetail {
  return {
    id: "inv-1",
    invoiceCode: "INV-0001",
    businessId: "biz",
    quotationId: "q-1",
    quotationCode: null,
    inspectionRequestId: "",
    serviceTitle: "Gutter clean",
    customer: { fullName: "Test Customer", email: "", phone: "" },
    address: { street: "", suburb: "", state: "", postcode: "" },
    lineItems: [],
    subtotalAud: 100,
    discountAud: 0,
    gstAud: 10,
    gstPricing: "exclusive",
    finalPriceAud: 110,
    balanceDueAud: 110,
    amountPaidAud: 0,
    payments: [],
    depositRequest: null,
    notes: null,
    termsAndConditions: null,
    invoiceDate: "2026-11-20",
    dueDate: "2026-11-27",
    status: "sent",
    bookingId: null,
    bookingCode: null,
    bookingStatus: null,
    bookingStatusAt: null,
    pdfUrl: null,
    cancelledAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  } as InvoiceDetail;
}

describe("invoiceDueItems", () => {
  it("lists issued invoices with money owed on their due date", () => {
    const [item] = invoiceDueItems([invoice({})], TZ, NOW);
    assert.equal(item.date, "2026-11-27");
    assert.equal(item.outstandingAud, 110);
    assert.equal(item.isOverdue, false);
    assert.equal(item.customerName, "Test Customer");
  });

  it("leaves out drafts, paid, cancelled and fully settled invoices", () => {
    const items = invoiceDueItems(
      [
        invoice({ id: "d", status: "draft" }),
        invoice({ id: "p", status: "paid" }),
        invoice({ id: "c", status: "cancelled" }),
        invoice({ id: "s", amountPaidAud: 110 }),
      ],
      TZ,
      NOW,
    );
    assert.deepEqual(items, []);
  });

  it("shows only what is still owed after part payments", () => {
    const [item] = invoiceDueItems([invoice({ amountPaidAud: 40 })], TZ, NOW);
    assert.equal(item.outstandingAud, 70);
    assert.equal(item.totalAud, 110);
  });

  it("marks past due dates as overdue", () => {
    const [item] = invoiceDueItems([invoice({ dueDate: "2026-11-25" })], TZ, NOW);
    assert.equal(item.isOverdue, true);
  });

  it("skips invoices without a valid due date and sorts by date", () => {
    const items = invoiceDueItems(
      [
        invoice({ id: "b", invoiceCode: "INV-2", dueDate: "2026-12-05" }),
        invoice({ id: "x", dueDate: "" }),
        invoice({ id: "a", invoiceCode: "INV-1", dueDate: "2026-12-01" }),
      ],
      TZ,
      NOW,
    );
    assert.deepEqual(
      items.map((item) => item.invoiceId),
      ["a", "b"],
    );
  });
});

describe("calendar events", () => {
  it("colours due invoices teal and overdue ones red", () => {
    const items = invoiceDueItems(
      [invoice({ id: "due" }), invoice({ id: "late", dueDate: "2026-11-01" })],
      TZ,
      NOW,
    );
    const events = buildInvoiceDueCalendarEvents(items);
    const byId = new Map(events.map((event) => [event.requestId, event]));
    assert.equal(byId.get("due")?.dotColor, "teal-500");
    assert.equal(byId.get("late")?.dotColor, "error");
    assert.equal(byId.get("late")?.source, "invoices");
  });

  it("totals amounts to the cent and links to the invoice preview", () => {
    const items = invoiceDueItems(
      [
        invoice({ id: "a", balanceDueAud: 0.1, finalPriceAud: 0.1 }),
        invoice({ id: "b", balanceDueAud: 0.2, finalPriceAud: 0.2 }),
      ],
      TZ,
      NOW,
    );
    assert.equal(totalOutstandingAud(items), 0.3);
    assert.equal(invoiceDueHref(items[0]), "/dashboard/invoices?view=a");
    const [late] = invoiceDueItems([invoice({ dueDate: "2026-11-01" })], TZ, NOW);
    assert.equal(invoiceDueHref(late), "/dashboard/invoices?filter=overdue&view=inv-1");
  });
});
