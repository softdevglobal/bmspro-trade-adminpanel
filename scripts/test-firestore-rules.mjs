/**
 * Firestore security rules tests.
 *
 * Run with `npm run test:rules`, which starts the Firestore emulator, loads
 * firestore.rules into it, and executes this file.
 *
 * The cases here are the tenant-isolation guarantees the rules exist to provide,
 * written so a regression fails loudly:
 *
 *   - one tenant cannot read another tenant's documents
 *   - customers cannot reach business-owner data
 *   - staff cannot reach super-admin-only collections
 *   - nobody can escalate their own role by writing their user document
 *   - a token's email is not an identity claim
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, getDoc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";

const PROJECT_ID = "bms-rules-test";

const BUSINESS_A = "biz-a";
const BUSINESS_B = "biz-b";

const ownerA = { role: "owner", businessId: BUSINESS_A };
const ownerB = { role: "owner", businessId: BUSINESS_B };
const staffA = { role: "staff", businessId: BUSINESS_A };
const superAdmin = { role: "super_admin", superAdmin: true };
const customer = {};

let passed = 0;
let failed = 0;
const failures = [];

async function expect(name, promise) {
  try {
    await promise;
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${error.message?.split("\n")[0]}`);
  }
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8"),
    host: "127.0.0.1",
    port: 8080,
  },
});

/** Seed with rules disabled: this is fixture data, not a behaviour under test. */
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();

  await setDoc(doc(db, "businesses", BUSINESS_A), {
    ownerUid: "owner-a",
    isActive: true,
    status: "active",
  });
  await setDoc(doc(db, "businesses", BUSINESS_B), {
    ownerUid: "owner-b",
    isActive: true,
    status: "active",
  });

  for (const [businessId, suffix] of [
    [BUSINESS_A, "a"],
    [BUSINESS_B, "b"],
  ]) {
    await setDoc(doc(db, "jobs", `job-${suffix}`), {
      businessId,
      customerId: `customer-${suffix}`,
      customer: { email: "shared@example.com" },
    });
    await setDoc(doc(db, "invoices", `invoice-${suffix}`), { businessId });
    await setDoc(doc(db, "items", `item-${suffix}`), { businessId });
    await setDoc(doc(db, "quotations", `quote-${suffix}`), { businessId });
    await setDoc(doc(db, "requests", `request-${suffix}`), {
      businessId,
      customerId: `customer-${suffix}`,
      customer: { email: "shared@example.com" },
    });
    await setDoc(doc(db, "customer_notifications", `notif-${suffix}`), {
      customerId: `customer-${suffix}`,
      customerEmail: "shared@example.com",
      read: false,
    });
    await setDoc(doc(db, "business_notifications", `bnotif-${suffix}`), {
      businessId,
      read: false,
    });
  }

  // A collection with no explicit rule: reachable only through the super-admin
  // catch-all at the bottom of firestore.rules.
  await setDoc(doc(db, "platform_settings", "stripe"), { secretRef: "x" });
});

const asOwnerA = testEnv.authenticatedContext("owner-a", ownerA).firestore();
const asOwnerB = testEnv.authenticatedContext("owner-b", ownerB).firestore();
const asStaffA = testEnv.authenticatedContext("staff-a", staffA).firestore();
const asSuperAdmin = testEnv.authenticatedContext("root", superAdmin).firestore();
const asCustomerA = testEnv.authenticatedContext("customer-a", customer).firestore();
const anonymous = testEnv.unauthenticatedContext().firestore();

console.log("\ntenant isolation — owner A cannot reach tenant B");
for (const [collection, id] of [
  ["jobs", "job-b"],
  ["invoices", "invoice-b"],
  ["items", "item-b"],
  ["quotations", "quote-b"],
  ["requests", "request-b"],
  ["business_notifications", "bnotif-b"],
]) {
  await expect(
    `owner A denied ${collection}/${id}`,
    assertFails(getDoc(doc(asOwnerA, collection, id))),
  );
}

console.log("\ntenant isolation — owner A reaches its own tenant");
for (const [collection, id] of [
  ["jobs", "job-a"],
  ["invoices", "invoice-a"],
  ["items", "item-a"],
  ["quotations", "quote-a"],
  ["requests", "request-a"],
  ["businesses", BUSINESS_A],
]) {
  await expect(
    `owner A allowed ${collection}/${id}`,
    assertSucceeds(getDoc(doc(asOwnerA, collection, id))),
  );
}
await expect(
  "owner A denied tenant B business document",
  assertFails(getDoc(doc(asOwnerA, "businesses", BUSINESS_B))),
);

console.log("\ntoken email is not an identity claim");
// Both tenants' jobs carry customer.email "shared@example.com". An owner whose
// own login uses that address must still be confined to their own tenant.
const asOwnerBWithCustomerEmail = testEnv
  .authenticatedContext("owner-b", { ...ownerB, email: "shared@example.com" })
  .firestore();
await expect(
  "matching token email does not grant another tenant's job",
  assertFails(getDoc(doc(asOwnerBWithCustomerEmail, "jobs", "job-a"))),
);
await expect(
  "matching token email does not grant another tenant's request",
  assertFails(getDoc(doc(asOwnerBWithCustomerEmail, "requests", "request-a"))),
);
await expect(
  "matching token email does not grant a customer notification",
  assertFails(
    getDoc(doc(asOwnerBWithCustomerEmail, "customer_notifications", "notif-a")),
  ),
);

console.log("\ncustomers cannot reach business-owner data");
for (const [collection, id] of [
  ["invoices", "invoice-a"],
  ["items", "item-a"],
  ["quotations", "quote-a"],
  ["business_notifications", "bnotif-a"],
  ["businesses", BUSINESS_A],
]) {
  await expect(
    `customer denied ${collection}/${id}`,
    assertFails(getDoc(doc(asCustomerA, collection, id))),
  );
}
await expect(
  "customer reads own notification",
  assertSucceeds(getDoc(doc(asCustomerA, "customer_notifications", "notif-a"))),
);
await expect(
  "customer denied another customer's notification",
  assertFails(getDoc(doc(asCustomerA, "customer_notifications", "notif-b"))),
);
await expect(
  "customer reads own job",
  assertSucceeds(getDoc(doc(asCustomerA, "jobs", "job-a"))),
);
await expect(
  "customer denied another customer's job",
  assertFails(getDoc(doc(asCustomerA, "jobs", "job-b"))),
);

console.log("\nstaff boundaries");
await expect(
  "staff reads own tenant's job",
  assertSucceeds(getDoc(doc(asStaffA, "jobs", "job-a"))),
);
await expect(
  "staff denied other tenant's job",
  assertFails(getDoc(doc(asStaffA, "jobs", "job-b"))),
);
await expect(
  "staff denied super-admin-only collection",
  assertFails(getDoc(doc(asStaffA, "platform_settings", "stripe"))),
);
await expect(
  "owner denied super-admin-only collection",
  assertFails(getDoc(doc(asOwnerA, "platform_settings", "stripe"))),
);
await expect(
  "super admin reads super-admin-only collection",
  assertSucceeds(getDoc(doc(asSuperAdmin, "platform_settings", "stripe"))),
);

console.log("\nprivilege escalation via own user document");
await expect(
  "cannot self-create a user document carrying a role",
  assertFails(
    setDoc(doc(asStaffA, "users", "staff-a"), {
      role: "owner",
      businessId: BUSINESS_B,
    }),
  ),
);
await expect(
  "cannot self-create a user document carrying a businessId",
  assertFails(
    setDoc(doc(asStaffA, "users", "staff-a"), { businessId: BUSINESS_B }),
  ),
);
await expect(
  "can register own FCM token",
  assertSucceeds(
    setDoc(doc(asStaffA, "users", "staff-a"), {
      fcmToken: "token",
      fcmTokenUpdatedAt: 1,
      platform: "ios",
    }),
  ),
);
await expect(
  "cannot add a role to an existing user document",
  assertFails(updateDoc(doc(asStaffA, "users", "staff-a"), { role: "owner" })),
);
await expect(
  "cannot read another user's document",
  assertFails(getDoc(doc(asStaffA, "users", "owner-b"))),
);

console.log("\nleave requests stay inside the requester's tenant");
await expect(
  "staff files leave in own tenant",
  assertSucceeds(
    setDoc(doc(asStaffA, "leaveRequests", "leave-ok"), {
      requesterUid: "staff-a",
      businessId: BUSINESS_A,
      status: "pending",
    }),
  ),
);
await expect(
  "staff cannot file leave into another tenant",
  assertFails(
    setDoc(doc(asStaffA, "leaveRequests", "leave-cross"), {
      requesterUid: "staff-a",
      businessId: BUSINESS_B,
      status: "pending",
    }),
  ),
);
await expect(
  "staff cannot file leave on someone else's behalf",
  assertFails(
    setDoc(doc(asStaffA, "leaveRequests", "leave-spoof"), {
      requesterUid: "staff-b",
      businessId: BUSINESS_A,
      status: "pending",
    }),
  ),
);
await expect(
  "staff cannot self-approve leave",
  assertFails(
    setDoc(doc(asStaffA, "leaveRequests", "leave-approved"), {
      requesterUid: "staff-a",
      businessId: BUSINESS_A,
      status: "approved",
    }),
  ),
);

console.log("\nwrites remain server-side only");
await expect(
  "owner cannot write a job",
  assertFails(setDoc(doc(asOwnerA, "jobs", "job-a"), { businessId: BUSINESS_A })),
);
await expect(
  "owner cannot write an invoice",
  assertFails(
    setDoc(doc(asOwnerA, "invoices", "invoice-a"), { businessId: BUSINESS_A }),
  ),
);
await expect(
  "owner cannot delete a job",
  assertFails(deleteDoc(doc(asOwnerA, "jobs", "job-a"))),
);
await expect(
  "owner cannot modify its own business document",
  assertFails(
    updateDoc(doc(asOwnerA, "businesses", BUSINESS_A), { isActive: false }),
  ),
);

console.log("\nanonymous access");
for (const [collection, id] of [
  ["jobs", "job-a"],
  ["invoices", "invoice-a"],
  ["businesses", BUSINESS_A],
  ["customer_notifications", "notif-a"],
  ["platform_settings", "stripe"],
]) {
  await expect(
    `anonymous denied ${collection}/${id}`,
    assertFails(getDoc(doc(anonymous, collection, id))),
  );
}
await expect(
  "anonymous reads the public plan catalogue",
  assertSucceeds(getDoc(doc(anonymous, "subscription_plans", "plan-1"))),
);

await testEnv.cleanup();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nFailing cases:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
console.log("");
