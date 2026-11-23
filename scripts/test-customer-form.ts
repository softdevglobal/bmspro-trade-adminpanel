import assert from "node:assert/strict";
import test from "node:test";
import { sameCustomer, validateCustomerForm } from "../lib/customer/form";
import {
  CUSTOMER_FORM_STEP_TOOL_NAME, OPEN_ADD_CUSTOMER_TOOL_NAME, OPEN_EDIT_CUSTOMER_TOOL_NAME, LIST_CUSTOMERS_TOOL_NAME,
  OWNER_CUSTOMER_BROWSER_TOOL_NAMES, OWNER_CUSTOMER_INSTRUCTIONS, ownerCustomerBrowserTools, ownerCustomersEnabled,
  consumeOpenCustomerForm, requestOpenCustomerForm, runCustomerFormStep, searchCustomers,
} from "../lib/ai/owner-call/owner-customer";

const good = { fullName: "  Nira Jay ", email: " Nira@Example.COM ", phone: "0412 345 678" };

test("a valid customer is cleaned up", () => {
  const result = validateCustomerForm(good);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.fullName, "Nira Jay");
    assert.equal(result.value.email, "nira@example.com");
    assert.equal(result.value.address, null);
  }
});

test("name, email and mobile are required", () => {
  assert.equal(validateCustomerForm({ ...good, fullName: "N" }).ok, false);
  assert.equal(validateCustomerForm({ ...good, email: "not-an-email" }).ok, false);
  assert.equal(validateCustomerForm({ ...good, phone: "123" }).ok, false);
  assert.equal(validateCustomerForm(null).ok, false);
});

test("an empty address is dropped, a partial one is kept", () => {
  const empty = validateCustomerForm({ ...good, address: { street: " ", suburb: "", state: "", postcode: "" } });
  assert.equal(empty.ok && empty.value.address, null);
  const partial = validateCustomerForm({ ...good, address: { suburb: "Newtown", state: "NSW" } });
  assert.equal(partial.ok && partial.value.address?.suburb, "Newtown");
});

test("the same email or phone is the same customer", () => {
  assert.equal(sameCustomer({ email: "A@x.com", phone: "" }, { email: "a@X.com", phone: "" }), "email");
  assert.equal(sameCustomer({ email: "a@x.com", phone: "0412 345 678" }, { email: "b@x.com", phone: "0412345678" }), "phone");
  assert.equal(sameCustomer({ email: "a@x.com", phone: "123" }, { email: "b@x.com", phone: "123" }), null); // too short to match on
  assert.equal(sameCustomer({ email: "a@x.com", phone: "0412345678" }, { email: "b@x.com", phone: "0499999999" }), null);
});

test("customer search matches name, email and phone digits", () => {
  const list = [
    { fullName: "Nira Jay", email: "nirangasoft@gmail.com", phone: "766524216" },
    { fullName: "Wasana", email: "wasana@gmail.com", phone: "786254896" },
  ];
  assert.equal(searchCustomers(list, "nira").length, 1);
  assert.equal(searchCustomers(list, "wasana@").length, 1);
  assert.equal(searchCustomers(list, "+61 786 254").length, 1);
  assert.equal(searchCustomers(list, "zzz").length, 0);
});

test("the voice tools are named, short on instructions, and off unless flagged", () => {
  const names = ownerCustomerBrowserTools().map((tool) => tool.name).sort();
  assert.deepEqual(names, [...OWNER_CUSTOMER_BROWSER_TOOL_NAMES].sort());
  assert.deepEqual(names, [CUSTOMER_FORM_STEP_TOOL_NAME, LIST_CUSTOMERS_TOOL_NAME, OPEN_ADD_CUSTOMER_TOOL_NAME, OPEN_EDIT_CUSTOMER_TOOL_NAME].sort());
  assert.ok(OWNER_CUSTOMER_INSTRUCTIONS.length < 100); // Sophie's instructions are capped at 4,000 characters
  assert.equal(ownerCustomersEnabled({}), false);
  assert.equal(ownerCustomersEnabled({ AI_OWNER_VOICE_CUSTOMERS_ENABLED: "true" }), true);
});

test("an open request is handed over once, and a form step needs an open popup", async () => {
  requestOpenCustomerForm({ mode: "add" });
  assert.deepEqual(consumeOpenCustomerForm(), { mode: "add" });
  assert.equal(consumeOpenCustomerForm(), null);
  const result = await runCustomerFormStep({ action: "fill", fullName: "A" });
  assert.equal(result.status, "NOT_OPEN");
});
