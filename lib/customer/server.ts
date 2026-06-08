import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { toMillis } from "@/lib/onboarding/services/display";
import {
  CUSTOMER_COLLECTION,
  normalizeEmail,
  normalizePhone,
  type CustomerProfile,
  type CustomerProfileInput,
} from "@/lib/customer/types";
import { sendCustomerWelcomeEmail } from "@/lib/email/templates";
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
  const registeredBusinessId =
    typeof data.registeredBusinessId === "string" &&
    data.registeredBusinessId.length > 0
      ? data.registeredBusinessId
      : null;
  const registeredBookingSlug =
    typeof data.registeredBookingSlug === "string" &&
    data.registeredBookingSlug.length > 0
      ? data.registeredBookingSlug
      : null;
  const registeredBusinessName =
    typeof data.registeredBusinessName === "string" &&
    data.registeredBusinessName.length > 0
      ? data.registeredBusinessName
      : null;

  return {
    uid,
    email: typeof data.email === "string" ? data.email : "",
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    phone: typeof data.phone === "string" ? data.phone : "",
    registeredBusinessId,
    registeredBookingSlug,
    registeredBusinessName,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
  };
}

async function resolveBusinessByBookingSlug(slug: string): Promise<{
  id: string;
  bookingSlug: string;
  businessName: string;
  logoUrl: string | null;
} | null> {
  const normalized = slug.trim();
  if (!normalized) return null;

  const snap = await adminDb
    .collection("businesses")
    .where("bookingSlug", "==", normalized)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    bookingSlug: normalized,
    businessName:
      typeof data.businessName === "string" ? data.businessName.trim() : "",
    logoUrl: typeof data.logoUrl === "string" ? data.logoUrl : null,
  };
}

/**
 * Writes registeredBusinessId, registeredBookingSlug, registeredBusinessName
 * once per customer (first signup from a /booknow/[slug] page).
 */
async function attachRegistrationBusinessIfEmpty(
  uid: string,
  bookingSlug: string | undefined,
): Promise<void> {
  if (!bookingSlug?.trim()) return;

  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(uid);
  const snap = await ref.get();
  const existing = snap.data() ?? {};
  if (
    typeof existing.registeredBusinessId === "string" &&
    existing.registeredBusinessId.length > 0
  ) {
    return;
  }

  const business = await resolveBusinessByBookingSlug(bookingSlug);
  if (!business) return;

  await ref.set(
    {
      registeredBusinessId: business.id,
      registeredBookingSlug: business.bookingSlug,
      registeredBusinessName: business.businessName,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

/** Reads or creates a baseline customer profile doc for the signed-in user. */
export async function getOrCreateCustomerProfile(
  customer: AuthedCustomer,
  options: { bookingSlug?: string } = {},
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
    }
    await attachRegistrationBusinessIfEmpty(customer.uid, options.bookingSlug);
    const refreshed = await ref.get();
    return mapCustomerDoc(refreshed.id, refreshed.data() ?? {});
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
  await attachRegistrationBusinessIfEmpty(customer.uid, options.bookingSlug);
  const created = await ref.get();
  const createdData = created.data() ?? {};

  await logAuditEvent({
    businessId:
      typeof createdData.registeredBusinessId === "string"
        ? createdData.registeredBusinessId
        : null,
    category: "customer",
    action: "customer.created",
    actor: {
      uid: customer.uid,
      role: "customer",
      name:
        typeof createdData.fullName === "string" && createdData.fullName
          ? createdData.fullName
          : null,
      email: customer.email,
    },
    source: "customer_portal",
    summary: `New customer ${customer.email} self-registered through the portal`,
    targetId: customer.uid,
    targetLabel:
      typeof createdData.fullName === "string" && createdData.fullName
        ? createdData.fullName
        : customer.email,
    metadata: { via: "self_signup" },
  });

  return mapCustomerDoc(created.id, createdData);
}

/** Default password for customer accounts created by a business owner. */
export const DEFAULT_CUSTOMER_PASSWORD = "00001111";

export type EnsuredCustomerAccount = {
  uid: string;
  email: string;
  /** True when the Firebase Auth user was created during this call. */
  created: boolean;
  /** True when a welcome email was sent during this call. */
  welcomeEmailSent: boolean;
};

/**
 * Ensures a customer account exists for the given email — creating a Firebase
 * Auth user with the default password and a `customers/{uid}` profile when one
 * doesn't already exist. Used when a business owner adds an inspection on a
 * customer's behalf. Best-effort welcome email with credentials on creation.
 */
export async function ensureCustomerAccount(input: {
  email: string;
  fullName: string;
  phone: string;
  businessId: string;
  businessName?: string | null;
  bookingSlug?: string | null;
  logoUrl?: string | null;
  /** Adjust welcome copy (e.g. quotation vs inspection). */
  context?: "quotation" | "inspection" | null;
}): Promise<EnsuredCustomerAccount> {
  const email = normalizeEmail(input.email);
  const fullName = input.fullName.trim();
  const phone = normalizePhone(input.phone);

  let uid: string;
  let created = false;

  try {
    const existing = await adminAuth.getUserByEmail(email);
    uid = existing.uid;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== "auth/user-not-found") throw error;

    const authUser = await adminAuth.createUser({
      email,
      password: DEFAULT_CUSTOMER_PASSWORD,
      displayName: fullName || undefined,
      emailVerified: false,
    });
    uid = authUser.uid;
    created = true;
  }

  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(uid);
  const snap = await ref.get();
  const now = FieldValue.serverTimestamp();

  // New to the customers collection — even if a login already existed.
  const isNewCustomer = !snap.exists;

  if (isNewCustomer) {
    await ref.set({
      uid,
      email,
      fullName,
      phone,
      registeredBusinessId: input.businessId,
      registeredBookingSlug: input.bookingSlug ?? null,
      registeredBusinessName: input.businessName ?? null,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const data = snap.data() ?? {};
    const update: Record<string, unknown> = { email, updatedAt: now };
    if (fullName && !data.fullName) update.fullName = fullName;
    if (phone && !data.phone) update.phone = phone;
    if (!data.registeredBusinessId) {
      update.registeredBusinessId = input.businessId;
      update.registeredBookingSlug = input.bookingSlug ?? null;
      update.registeredBusinessName = input.businessName ?? null;
    }
    await ref.set(update, { merge: true });
  }

  const profileSnap = await ref.get();
  const profileData = profileSnap.data() ?? {};
  const welcomeAlreadySent = profileData.welcomeEmailSent === true;
  const shouldSendWelcome = !welcomeAlreadySent;

  let welcomeEmailSent = false;
  if (shouldSendWelcome) {
    try {
      welcomeEmailSent = await sendCustomerWelcomeEmail({
        email,
        fullName,
        businessName: input.businessName ?? null,
        bookingSlug: input.bookingSlug ?? null,
        logoUrl: input.logoUrl ?? null,
        temporaryPassword: created ? DEFAULT_CUSTOMER_PASSWORD : null,
        context: input.context ?? null,
      });
      if (welcomeEmailSent) {
        await ref.set(
          { welcomeEmailSent: true, updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
      }
    } catch {
      /* welcome email is best-effort */
    }
  }

  return { uid, email, created, welcomeEmailSent };
}

export async function updateCustomerProfile(
  customer: AuthedCustomer,
  input: CustomerProfileInput,
): Promise<CustomerProfile> {
  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(customer.uid);
  const snap = await ref.get();
  const existing = snap.data() ?? {};
  const shouldSendWelcome =
    existing.welcomeEmailSent !== true && input.fullName.trim().length >= 2;

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

  await attachRegistrationBusinessIfEmpty(customer.uid, input.bookingSlug);

  const refreshed = await ref.get();
  const profile = mapCustomerDoc(refreshed.id, refreshed.data() ?? {});

  if (shouldSendWelcome) {
    try {
      const welcomeSlug =
        profile.registeredBookingSlug ?? input.bookingSlug ?? null;
      const welcomeBusiness = welcomeSlug
        ? await resolveBusinessByBookingSlug(welcomeSlug)
        : null;
      await sendCustomerWelcomeEmail({
        email: customer.email,
        fullName: profile.fullName,
        businessName: profile.registeredBusinessName,
        bookingSlug: welcomeSlug,
        logoUrl: welcomeBusiness?.logoUrl ?? null,
      });
      await ref.update({
        welcomeEmailSent: true,
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch {
      /* email is best-effort */
    }
  }

  return profile;
}
