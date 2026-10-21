import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { securityAdmin } from "./security-admin.mjs";

const { projectId, auth, db } = securityAdmin();
const planFile = process.argv.includes("--plan") ? process.argv[process.argv.indexOf("--plan") + 1] : "output/legacy-account-remediation.json";
if (!process.argv.includes("--apply")) {
  const [businesses, users, customers] = await Promise.all([db.collection("businesses").get(), db.collection("users").get(), db.collection("customers").get()]);
  const adminCreated = new Set(businesses.docs.filter((doc) => doc.data().source === "super_admin_create").map((doc) => doc.id));
  const accounts = [];
  for (const doc of users.docs) {
    const data = doc.data();
    if (!data.passwordChangedAt && !data.activationRequired &&
        ((data.role === "owner" && adminCreated.has(data.businessId)) || data.role === "staff")) {
      accounts.push({ uid: doc.id, collection: "users", reason: "Legacy provisioned account without server-recorded password change" });
    }
  }
  for (const doc of customers.docs) {
    if (doc.data().passwordChangedAt || doc.data().activationRequired) continue;
    const account = await auth.getUser(doc.id).catch(() => null);
    if (account && !account.emailVerified) accounts.push({ uid: doc.id, collection: "customers", reason: "Legacy customer without verified mailbox or server-recorded password change" });
  }
  writeFileSync(planFile, JSON.stringify({ projectId, accounts }, null, 2));
  console.log(`Dry run: ${accounts.length} candidates written to ${planFile}. Review the list before --apply. Firebase does not expose password hashes, so candidate selection is conservative.`);
} else {
  const plan = JSON.parse(readFileSync(planFile, "utf8"));
  if (plan.projectId !== projectId || !Array.isArray(plan.accounts)) throw new Error("Plan/project mismatch.");
  let changed = 0;
  for (const account of plan.accounts) {
    if (!["users", "customers"].includes(account.collection) || typeof account.uid !== "string" || account.uid.includes("/")) throw new Error("Invalid plan entry.");
    const ref = db.collection(account.collection).doc(account.uid);
    if (!(await ref.get()).exists) throw new Error("Profile missing; stop and review the plan.");
    // Gate first so any existing tokens immediately lose server/rules access.
    await ref.update({ activationRequired: true, mustChangePassword: true, updatedAt: FieldValue.serverTimestamp() });
    await auth.updateUser(account.uid, { password: randomBytes(32).toString("base64url") });
    await auth.revokeRefreshTokens(account.uid);
    changed++;
  }
  console.log(`${changed} accounts gated, randomized, and sessions revoked. Owners/staff use the admin reset-code flow; customers use their business-scoped reset-code flow. Notify affected account holders through the approved support process.`);
}
