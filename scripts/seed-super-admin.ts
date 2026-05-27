import { adminAuth, adminDb } from "../lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const SUPER_ADMIN = {
  email: "bmsprotrade@admin.com",
  password: "Admin@119",
  displayName: "BMS Pro Trade Super Admin",
};

async function ensureAuthUser() {
  try {
    const existing = await adminAuth.getUserByEmail(SUPER_ADMIN.email);
    console.log(`✓ Auth user already exists (uid=${existing.uid})`);

    await adminAuth.updateUser(existing.uid, {
      password: SUPER_ADMIN.password,
      displayName: SUPER_ADMIN.displayName,
      emailVerified: true,
      disabled: false,
    });
    console.log(`✓ Auth user password/profile refreshed`);
    return existing;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;

    const created = await adminAuth.createUser({
      email: SUPER_ADMIN.email,
      password: SUPER_ADMIN.password,
      displayName: SUPER_ADMIN.displayName,
      emailVerified: true,
    });
    console.log(`✓ Auth user created (uid=${created.uid})`);
    return created;
  }
}

async function setSuperAdminClaim(uid: string) {
  await adminAuth.setCustomUserClaims(uid, {
    role: "super_admin",
    superAdmin: true,
  });
  console.log(`✓ Custom claims set: { role: "super_admin", superAdmin: true }`);
}

async function writeSuperAdminDoc(
  uid: string,
  email: string,
  displayName: string
) {
  const ref = adminDb.collection("super_admins").doc(uid);
  const snap = await ref.get();

  const baseData = {
    uid,
    email,
    displayName,
    role: "super_admin",
    isActive: true,
    permissions: ["*"],
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (snap.exists) {
    await ref.update(baseData);
    console.log(`✓ super_admins/${uid} updated`);
  } else {
    await ref.set({
      ...baseData,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`✓ super_admins/${uid} created`);
  }
}

async function main() {
  console.log("Seeding BMS Pro Trade super admin...");
  console.log(`Email:    ${SUPER_ADMIN.email}`);
  console.log(`Password: ${SUPER_ADMIN.password}`);
  console.log("---");

  const user = await ensureAuthUser();
  await setSuperAdminClaim(user.uid);
  await writeSuperAdminDoc(user.uid, SUPER_ADMIN.email, SUPER_ADMIN.displayName);

  console.log("---");
  console.log("Done. The super admin can now sign in at /login.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
