import "server-only";

import { actorRoleFromClaim } from "@/lib/audit/types";
import { logAuditEvent } from "@/lib/audit/server";
import { sameCustomer, type CustomerFormInput } from "@/lib/customer/form";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { ensureCustomerAccount, listBusinessCustomers } from "@/lib/customer/server";
import { CUSTOMER_COLLECTION, normalizeEmail, normalizePhone, type CustomerProfile } from "@/lib/customer/types";
import { FieldValue } from "firebase-admin/firestore";

export type ManageAuth = { uid: string; email: string | null; name: string | null; role: string | null; businessId: string };
export type CustomerChannel = "manual" | "voice" | "mcp";

export type CreateCustomerResult =
  | { status: "CREATED"; customer: CustomerProfile; inviteSent: boolean }
  | { status: "DUPLICATE"; matchedOn: "email" | "phone"; customer: CustomerProfile };

/** The existing customer of THIS business with the same email or phone, if any. */
export async function findDuplicateCustomer(
  businessId: string,
  contact: { email: string; phone: string },
  excludeUid?: string,
): Promise<{ matchedOn: "email" | "phone"; customer: CustomerProfile } | null> {
  const all = await listBusinessCustomers(businessId);
  for (const customer of all) {
    if (customer.uid === excludeUid) continue;
    const matchedOn = sameCustomer(contact, customer);
    if (matchedOn) return { matchedOn, customer };
  }
  return null;
}

function actor(auth: ManageAuth, channel: CustomerChannel) {
  return {
    actor: { uid: auth.uid, role: actorRoleFromClaim(auth.role), name: auth.name, email: auth.email },
    source: channel === "manual" ? ("admin_panel" as const) : ("system" as const),
  };
}

/** Adds one customer. An existing email or phone is never overwritten: the duplicate is returned instead. */
export async function createBusinessCustomer(
  auth: ManageAuth,
  input: CustomerFormInput,
  options: { sendInvite?: boolean; channel?: CustomerChannel } = {},
): Promise<CreateCustomerResult> {
  const channel = options.channel ?? "manual";
  const duplicate = await findDuplicateCustomer(auth.businessId, input);
  if (duplicate) return { status: "DUPLICATE", ...duplicate };

  const business = (await adminDb.collection("businesses").doc(auth.businessId).get()).data() ?? {};
  const account = await ensureCustomerAccount({
    email: input.email,
    fullName: input.fullName,
    phone: input.phone,
    businessId: auth.businessId,
    businessName: typeof business.businessName === "string" ? business.businessName : null,
    bookingSlug: typeof business.bookingSlug === "string" ? business.bookingSlug : null,
    logoUrl: typeof business.logoUrl === "string" ? business.logoUrl : null,
    context: "onboarding",
    sendWelcomeEmail: options.sendInvite === true,
  });

  await adminDb.collection(CUSTOMER_COLLECTION).doc(account.uid).set(
    { company: input.company, notes: input.notes, address: input.address, source: channel, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  await logAuditEvent({
    businessId: auth.businessId,
    category: "customer",
    action: "customer.created",
    ...actor(auth, channel),
    summary: `Customer ${input.fullName} added`,
    targetId: account.uid,
    targetLabel: input.fullName,
    metadata: { via: channel, inviteSent: account.welcomeEmailSent },
  });

  const customer = (await listBusinessCustomers(auth.businessId)).find((c) => c.uid === account.uid);
  if (!customer) throw new Error("Customer was created but could not be loaded.");
  return { status: "CREATED", customer, inviteSent: account.welcomeEmailSent };
}

export type UpdateCustomerResult =
  | { status: "UPDATED"; customer: CustomerProfile }
  | { status: "NOT_FOUND" }
  | { status: "EMAIL_LOCKED"; message: string }
  | { status: "DUPLICATE"; matchedOn: "email" | "phone"; customer: CustomerProfile };

/** Edits one customer of this business. The email is their login, so it cannot be changed here. */
export async function updateBusinessCustomer(
  auth: ManageAuth,
  uid: string,
  input: CustomerFormInput,
  channel: CustomerChannel = "manual",
): Promise<UpdateCustomerResult> {
  const ref = adminDb.collection(CUSTOMER_COLLECTION).doc(uid);
  const snap = await ref.get();
  const data = snap.data();
  if (!data || data.registeredBusinessId !== auth.businessId) return { status: "NOT_FOUND" };

  if (normalizeEmail(String(data.email ?? "")) !== normalizeEmail(input.email)) {
    return { status: "EMAIL_LOCKED", message: "The email is the customer's login and cannot be changed here." };
  }
  const duplicate = await findDuplicateCustomer(auth.businessId, { email: "", phone: input.phone }, uid);
  if (duplicate) return { status: "DUPLICATE", ...duplicate };

  await ref.set(
    {
      fullName: input.fullName, phone: normalizePhone(input.phone), company: input.company,
      notes: input.notes, address: input.address, updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  try { await adminAuth.updateUser(uid, { displayName: input.fullName }); } catch { /* the profile is already saved */ }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "customer",
    action: "customer.updated",
    ...actor(auth, channel),
    summary: `Customer ${input.fullName} updated`,
    targetId: uid,
    targetLabel: input.fullName,
    metadata: { via: channel },
  });

  const customer = (await listBusinessCustomers(auth.businessId)).find((c) => c.uid === uid);
  if (!customer) return { status: "NOT_FOUND" };
  return { status: "UPDATED", customer };
}
