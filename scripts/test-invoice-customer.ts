/**
 * Unit tests for who an invoice is addressed to.
 *
 * Run: npm run test:invoice-customer
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveInvoiceCustomer } from "../lib/invoices/customer";

const quotation = {
  customer: { fullName: "Sam Smith", email: "sam@example.com", phone: "0412345678" },
  address: { street: "1 Old St", suburb: "Oldtown", state: "VIC", postcode: "3000" },
};

describe("resolveInvoiceCustomer", () => {
  it("uses the quotation's customer when nothing is sent", () => {
    assert.deepEqual(resolveInvoiceCustomer({}, quotation), quotation);
  });

  it("uses edited customer details, trimmed", () => {
    const result = resolveInvoiceCustomer(
      { customer: { fullName: "  Sam J Smith ", email: " new@example.com ", phone: " 0499 " } },
      quotation,
    );
    assert.deepEqual(result.customer, {
      fullName: "Sam J Smith",
      email: "new@example.com",
      phone: "0499",
    });
    assert.deepEqual(result.address, quotation.address);
  });

  it("uses an edited address, including clearing parts of it", () => {
    const result = resolveInvoiceCustomer(
      { address: { street: " 21 Yapa St ", suburb: "Kandy", state: "", postcode: "2018" } },
      quotation,
    );
    assert.deepEqual(result.address, {
      street: "21 Yapa St",
      suburb: "Kandy",
      state: "",
      postcode: "2018",
    });
    assert.deepEqual(result.customer, quotation.customer);
  });

  it("ignores a blank name instead of wiping the customer", () => {
    const result = resolveInvoiceCustomer(
      { customer: { fullName: "   ", email: "x@y.com", phone: "1" } },
      quotation,
    );
    assert.deepEqual(result.customer, quotation.customer);
  });

  it("lets the email be cleared on purpose", () => {
    const result = resolveInvoiceCustomer(
      { customer: { fullName: "Sam Smith", email: "", phone: "0412345678" } },
      quotation,
    );
    assert.equal(result.customer.email, "");
  });
});
