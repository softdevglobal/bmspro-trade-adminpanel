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

const PROJECT_ID = "demo-bms-security-test";

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


console.log("\nparticipant onboarding stays behind the business-scoped API");
await testEnv.withSecurityRulesDisabled(async (context) => {
  await setDoc(doc(context.firestore(), "participant_onboarding", BUSINESS_A, "records", "participant-a"), {
    participantName: "Participant A", status: "draft", updatedAt: "2026-10-07T00:00:00.000Z",
  });
});
for (const [name, db] of [
  ["owner", asOwnerA], ["other tenant owner", asOwnerB], ["staff", asStaffA],
  ["super admin", asSuperAdmin], ["customer", asCustomerA], ["anonymous", anonymous],
]) {
  await expect(name + " cannot directly read participant onboarding",
    assertFails(getDoc(doc(db, "participant_onboarding", BUSINESS_A, "records", "participant-a"))));
  await expect(name + " cannot directly write participant onboarding",
    assertFails(setDoc(doc(db, "participant_onboarding", BUSINESS_A, "records", "participant-a"), { participantName: "Changed" })));
}

console.log("\nactivation and attendance integrity");
await testEnv.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore();
  await setDoc(doc(db, "users", "pending-owner"), { role: "owner", businessId: BUSINESS_A, activationRequired: true });
  await setDoc(doc(db, "customers", "pending-customer"), { activationRequired: true });
  await setDoc(doc(db, "jobs", "pending-customer-job"), { businessId: BUSINESS_A, customerId: "pending-customer" });
  await setDoc(doc(db, "staff_check_ins", "check-in-a"), { staffId: "staff-a", businessId: BUSINESS_A, ownerUid: "owner-a", checkInTime: new Date() });
  await setDoc(doc(db, "users", "inactive-agent"), { role: "call_center", isActive: false, status: "inactive" });
  await setDoc(doc(db, "conversations", "active-room"), { userId: "owner-a" });
});
const pendingOwnerDb = testEnv.authenticatedContext("pending-owner", ownerA).firestore();
await expect("pending owner cannot read tenant data even with owner claims", assertFails(getDoc(doc(pendingOwnerDb, "businesses", BUSINESS_A))));
await expect("pending owner cannot clear activation state", assertFails(updateDoc(doc(pendingOwnerDb, "users", "pending-owner"), { activationRequired: false })));
const pendingCustomerDb = testEnv.authenticatedContext("pending-customer", {}).firestore();
await expect("pending customer cannot read own booking", assertFails(getDoc(doc(pendingCustomerDb, "jobs", "pending-customer-job"))));
await expect("staff cannot move attendance to another tenant", assertFails(updateDoc(doc(asStaffA, "staff_check_ins", "check-in-a"), { businessId: BUSINESS_B })));
await expect("staff cannot forge attendance timestamps or owner", assertFails(updateDoc(doc(asStaffA, "staff_check_ins", "check-in-a"), { checkInTime: new Date(0), ownerUid: "owner-b" })));
await expect("staff cannot create unsupported attendance records", assertFails(setDoc(doc(asStaffA, "staff_check_ins", "forged"), { staffId: "staff-a", businessId: BUSINESS_A, unexpected: true })));
const inactiveAgentDb = testEnv.authenticatedContext("inactive-agent", { role: "call_center" }).firestore();
await expect("inactive agent cannot read conversations with stale role claim", assertFails(getDoc(doc(inactiveAgentDb, "conversations", "active-room"))));
for (const collection of ["account_activations", "security_rate_limits", "payment_checkout_sessions", "payment_receipts"]) {
  await expect("client cannot alter " + collection, assertFails(setDoc(doc(asSuperAdmin, collection, "forged"), { businessId: BUSINESS_A })));
}

console.log("\nbusiness-mailbox data is server-only (Admin SDK)");
const EMAIL_FIXTURES = [
  ["email_connections", "conn-a"],
  ["email_connection_credentials", "conn-a"],
  ["email_outbox", "outbox-a"],
  ["email_events", "event-a"],
  ["email_oauth_states", "state-a"],
  ["email_messages", "message-a"],
  ["email_sync_state", "sync-a"],
];
await testEnv.withSecurityRulesDisabled(async (context) => {
  for (const [collection, id] of EMAIL_FIXTURES) {
    await setDoc(doc(context.firestore(), collection, id), { businessId: BUSINESS_A });
  }
});
for (const [name, db] of [
  ["owner", asOwnerA], ["other tenant owner", asOwnerB], ["staff", asStaffA],
  ["super admin", asSuperAdmin], ["customer", asCustomerA], ["anonymous", anonymous],
]) {
  for (const [collection, id] of EMAIL_FIXTURES) {
    await expect(`${name} cannot read ${collection}`,
      assertFails(getDoc(doc(db, collection, id))));
    await expect(`${name} cannot write ${collection}`,
      assertFails(setDoc(doc(db, collection, id), { businessId: BUSINESS_A, status: "accepted" })));
  }
}

await testEnv.cleanup();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log(`\nFailing cases:\n  - ${failures.join("\n  - ")}\n`);
  process.exit(1);
}
console.log("");
