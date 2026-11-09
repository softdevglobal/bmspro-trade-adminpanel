/**
 * Unit tests for the Quotations and Invoices summary card values.
 *
 * Run: npm run test:value-summaries
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isPaidValueInvoice,
  isUnpaidValueInvoice,
  receivedInvoiceAud,
  summarizeInvoiceValues,
} from "../lib/invoices/summary";
import {
  isApprovedQuotation,
  isPendingValueQuotation,
  summarizeQuotationValues,
} from "../lib/quotations/summary";

type Q = Parameters<typeof summarizeQuotationValues>[0][number];
type I = Parameters<typeof summarizeInvoiceValues>[0][number];

const quote = (overrides: Partial<Q>): Q => ({
  status: "sent",
  customerDecision: null,
  bookingId: null,
  invoiceId: null,
  finalPriceAud: 100,
  createdSource: null,
  ...overrides,
});

const invoice = (overrides: Partial<I>): I => ({
  status: "sent",
  finalPriceAud: 100,
  balanceDueAud: 100,
  amountPaidAud: 0,
  ...overrides,
});

describe("summarizeQuotationValues", () => {
  it("splits pending and approved quotes and skips the rest", () => {
    const result = summarizeQuotationValues([
      quote({ status: "draft", finalPriceAud: 50 }), // pending
      quote({ finalPriceAud: 200 }), // sent, awaiting customer: pending
      quote({ customerDecision: "accepted", finalPriceAud: 300 }), // approved
      quote({ bookingId: "b1", finalPriceAud: 400 }), // became a job: approved
      quote({ invoiceId: "i1", finalPriceAud: 500 }), // invoiced: approved
      quote({ customerDecision: "rejected", finalPriceAud: 600 }), // neither
      quote({ status: "cancelled", customerDecision: "accepted", finalPriceAud: 700 }), // neither
      quote({ createdSource: "invoice_direct", invoiceId: "i2", finalPriceAud: 800 }), // neither
    ]);
    assert.deepEqual(result, {
      pendingAud: 250,
      pendingCount: 2,
      approvedAud: 1200,
      approvedCount: 3,
    });
  });

  it("rounds to cents and ignores missing amounts", () => {
    const result = summarizeQuotationValues([
      quote({ finalPriceAud: 0.1 }),
      quote({ finalPriceAud: 0.2 }),
      quote({ finalPriceAud: Number.NaN }),
    ]);
    assert.equal(result.pendingAud, 0.3);
    assert.equal(result.pendingCount, 3);
  });

  it("is zero with no quotes", () => {
    assert.deepEqual(summarizeQuotationValues([]), {
      pendingAud: 0,
      pendingCount: 0,
      approvedAud: 0,
      approvedCount: 0,
    });
  });
});

describe("summarizeInvoiceValues", () => {
  it("counts paid in full, part-payments and what is still owed", () => {
    const result = summarizeInvoiceValues([
      invoice({ status: "paid", finalPriceAud: 500, balanceDueAud: 500, amountPaidAud: 500 }),
      invoice({ finalPriceAud: 300, balanceDueAud: 300 }), // nothing paid yet
      // $100 deposit received, then $50 paid online: $150 paid, $150 owing.
      invoice({ finalPriceAud: 300, balanceDueAud: 200, amountPaidAud: 50 }),
      invoice({ status: "draft", finalPriceAud: 900 }), // not issued
      invoice({ status: "cancelled", finalPriceAud: 900 }), // void
    ]);
    assert.deepEqual(result, {
      paidAud: 650,
      paidCount: 1,
      unpaidAud: 450,
      unpaidCount: 2,
    });
  });

  it("paid plus unpaid equals the total issued", () => {
    const invoices = [
      invoice({ status: "paid", finalPriceAud: 123.45 }),
      invoice({ finalPriceAud: 99.99, balanceDueAud: 49.99, amountPaidAud: 10 }),
    ];
    const result = summarizeInvoiceValues(invoices);
    assert.equal(Math.round((result.paidAud + result.unpaidAud) * 100) / 100, 223.44);
  });

  it("an issued invoice fully settled online is paid, not owing", () => {
    const result = summarizeInvoiceValues([
      invoice({ finalPriceAud: 200, balanceDueAud: 200, amountPaidAud: 200 }),
    ]);
    assert.deepEqual(result, { paidAud: 200, paidCount: 0, unpaidAud: 0, unpaidCount: 0 });
  });
});

describe("tile filters show exactly what each tile adds up", () => {
  it("quotes", () => {
    const quotes = [
      quote({ status: "draft", finalPriceAud: 50 }),
      quote({ finalPriceAud: 200 }),
      quote({ customerDecision: "accepted", finalPriceAud: 300 }),
      quote({ customerDecision: "rejected", finalPriceAud: 600 }),
    ];
    const summary = summarizeQuotationValues(quotes);
    const pending = quotes.filter(isPendingValueQuotation);
    assert.equal(pending.length, summary.pendingCount);
    assert.equal(pending.reduce((t, q) => t + q.finalPriceAud, 0), summary.pendingAud);
    assert.equal(quotes.filter(isApprovedQuotation).length, summary.approvedCount);
  });

  it("invoices", () => {
    const invoices = [
      invoice({ status: "paid", finalPriceAud: 500 }),
      invoice({ finalPriceAud: 300, balanceDueAud: 200, amountPaidAud: 50 }), // both
      invoice({ finalPriceAud: 300, balanceDueAud: 300 }), // unpaid only
      invoice({ status: "draft", finalPriceAud: 900 }), // neither
    ];
    const summary = summarizeInvoiceValues(invoices);
    const paid = invoices.filter(isPaidValueInvoice);
    const unpaid = invoices.filter(isUnpaidValueInvoice);
    assert.equal(paid.length, 2);
    assert.equal(paid.reduce((t, i) => t + receivedInvoiceAud(i), 0), summary.paidAud);
    assert.equal(unpaid.length, summary.unpaidCount);
  });
});
