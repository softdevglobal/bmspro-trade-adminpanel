import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  CUSTOMER_COLLECTION,
  normalizeEmail,
  type CustomerProfile,
  type CustomerProfileInput,
} from "@/lib/customer/types";
import { FieldValue } from "firebase-admin/firestore";

export type AuthedCustomer = {
  uid: string;
  email: string;
};

/** Validates a Bearer ID token from a customer client and returns uid/email. */
export async function authenticateCustomerRequest(
  request: Request,
): Promise<
  | { ok: true; customer: AuthedCustomer }
  | { ok: false; status: number; error: string }
> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Sign in to continue." };
  }
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const uid = decoded.uid;
    const email =
      typeof decoded.email === "string" && decoded.email
        ? decoded.email
        : null;
    if (!email) {
      return { ok: false, status: 401, error: "Account email is missing." };
    }
    return { ok: true, customer: { uid, email: normalizeEmail(email) } };
  } catch {
    return { ok: false, status: 401, error: "Session expired. Sign in again." };
  }
}

function mapCustomerDoc(uid: string, data: Record<string, unknown>): CustomerProfile {
  return {
    uid,
    email: typeof data.email === "string" ? data.email : "",
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

/** Reads or creates a baseline customer profile doc for the signed-in user. */
export async function getOrCreateCustomerProfile(
  customer: AuthedCustomer,
): Promise<CustomerProfile> {
  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(customer.uid);
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() ?? {};
    if (typeof data.email !== "string" || data.email !== customer.email) {
      await ref.update({
        email: customer.email,
        updatedAt: FieldValue.serverTimestamp(),
      });
      const refreshed = await ref.get();
      return mapCustomerDoc(refreshed.id, refreshed.data() ?? {});
    }
    return mapCustomerDoc(snap.id, data);
  }

  const now = FieldValue.serverTimestamp();
  await ref.set({
    uid: customer.uid,
    email: customer.email,
    fullName: "",
    phone: "",
    createdAt: now,
    updatedAt: now,
  });
  const created = await ref.get();
  return mapCustomerDoc(created.id, created.data() ?? {});
}

export async function updateCustomerProfile(
  customer: AuthedCustomer,
  input: CustomerProfileInput,
): Promise<CustomerProfile> {
  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(customer.uid);
  const snap = await ref.get();
  const now = FieldValue.serverTimestamp();
  if (!snap.exists) {
    await ref.set({
      uid: customer.uid,
      email: customer.email,
      fullName: input.fullName,
      phone: input.phone,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await ref.update({
      email: customer.email,
      fullName: input.fullName,
      phone: input.phone,
      updatedAt: now,
    });
  }
  const refreshed = await ref.get();
  return mapCustomerDoc(refreshed.id, refreshed.data() ?? {});
}
