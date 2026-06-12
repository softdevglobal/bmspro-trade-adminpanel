import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import {
  actorRoleFromClaim,
  type AuditActorRole,
  type AuditSource,
} from "@/lib/audit/types";
import { adminDb } from "@/lib/firebase/admin";

type BusinessAuthor = {
  uid: string;
  email: string | null;
  name: string | null;
  role: string | null;
  businessId: string;
};

type QuotationSummary = {
  id: string;
  quotationCode: string | null;
  finalPriceAud: number;
  customer: { fullName: string };
};

type InvoiceSummary = {
  id: string;
  invoiceCode: string;
  finalPriceAud: number;
  customer: { fullName: string };
  quotationCode?: string | null;
};

function actorFromAuthor(auth: BusinessAuthor) {
  return {
    uid: auth.uid,
    role: actorRoleFromClaim(auth.role),
    name: auth.name,
    email: auth.email,
  };
}

/** Records a "quotation.created" audit event (best-effort). */
export async function logQuotationCreated(
  auth: BusinessAuthor,
  quotation: QuotationSummary,
  origin: "standalone" | "from_inspection",
): Promise<void> {
  await logAuditEvent({
    businessId: auth.businessId,
    category: "quotation",
    action: "quotation.created",
    actor: actorFromAuthor(auth),
    source: "admin_panel",
    summary: `Quotation ${quotation.quotationCode ?? quotation.id} created for ${quotation.customer.fullName || "a customer"}`,
    targetId: quotation.id,
    targetLabel: quotation.customer.fullName || null,
    metadata: {
      quotationCode: quotation.quotationCode ?? null,
      finalPriceAud: quotation.finalPriceAud,
      origin,
    },
  });
}

/** Records a "quotation.sent" audit event (best-effort). */
export async function logQuotationSent(
  auth: BusinessAuthor,
  quotation: QuotationSummary,
  origin: "standalone" | "from_inspection",
): Promise<void> {
  await logAuditEvent({
    businessId: auth.businessId,
    category: "quotation",
    action: "quotation.sent",
    actor: actorFromAuthor(auth),
    source: "admin_panel",
    summary: `Quotation ${quotation.quotationCode ?? quotation.id} sent to ${quotation.customer.fullName || "customer"}`,
    targetId: quotation.id,
    targetLabel: quotation.customer.fullName || null,
    metadata: {
      quotationCode: quotation.quotationCode ?? null,
      finalPriceAud: quotation.finalPriceAud,
      origin,
    },
  });
}

/** Records an "invoice.created" audit event (best-effort). */
export async function logInvoiceCreated(
  auth: BusinessAuthor,
  invoice: InvoiceSummary,
  origin: "from_quotation" | "direct",
): Promise<void> {
  await logAuditEvent({
    businessId: auth.businessId,
    category: "invoice",
    action: "invoice.created",
    actor: actorFromAuthor(auth),
    source: "admin_panel",
    summary: `Invoice ${invoice.invoiceCode} created for ${invoice.customer.fullName || "a customer"}`,
    targetId: invoice.id,
    targetLabel: invoice.customer.fullName || null,
    metadata: {
      invoiceCode: invoice.invoiceCode,
      quotationCode: invoice.quotationCode ?? null,
      finalPriceAud: invoice.finalPriceAud,
      origin,
    },
  });
}

/** Records an "invoice.sent" audit event (best-effort). */
export async function logInvoiceSent(
  auth: BusinessAuthor,
  invoice: InvoiceSummary,
  origin: "from_quotation" | "direct",
): Promise<void> {
  await logAuditEvent({
    businessId: auth.businessId,
    category: "invoice",
    action: "invoice.sent",
    actor: actorFromAuthor(auth),
    source: "admin_panel",
    summary: `Invoice ${invoice.invoiceCode} sent to ${invoice.customer.fullName || "customer"}`,
    targetId: invoice.id,
    targetLabel: invoice.customer.fullName || null,
    metadata: {
      invoiceCode: invoice.invoiceCode,
      quotationCode: invoice.quotationCode ?? null,
      finalPriceAud: invoice.finalPriceAud,
      origin,
    },
  });
}

/** Records a password change for admin-panel users, staff, or customers. */
export async function logPasswordChanged(params: {
  uid: string;
  email: string | null;
  name: string | null;
  role: AuditActorRole;
  businessId: string | null;
  source: AuditSource;
  method: "in_app" | "reset_code" | "first_login";
}): Promise<void> {
  const isStaff = params.role === "staff";
  const category = isStaff ? "staff" : "auth";
  const action = isStaff ? "staff.password_changed" : "auth.password_changed";
  const who = params.name?.trim() || params.email?.trim() || "User";

  await logAuditEvent({
    businessId: params.businessId,
    category,
    action,
    actor: {
      uid: params.uid,
      role: params.role,
      name: params.name,
      email: params.email,
    },
    source: params.source,
    summary: isStaff
      ? `${who} changed their staff password`
      : `${who} changed their password`,
    targetId: params.uid,
    targetLabel: who,
    metadata: {
      method: params.method,
    },
  });
}

/** Resolves audit identity from Firestore profile collections. */
export async function resolveAuditIdentityForUid(uid: string): Promise<{
  uid: string;
  email: string | null;
  name: string | null;
  role: AuditActorRole;
  businessId: string | null;
}> {
  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (userSnap.exists) {
    const data = userSnap.data() ?? {};
    return {
      uid,
      email: typeof data.email === "string" ? data.email : null,
      name: typeof data.fullName === "string" ? data.fullName : null,
      role: actorRoleFromClaim(data.role),
      businessId:
        typeof data.businessId === "string" ? data.businessId : null,
    };
  }

  const superSnap = await adminDb.collection("super_admins").doc(uid).get();
  if (superSnap.exists) {
    const data = superSnap.data() ?? {};
    return {
      uid,
      email: typeof data.email === "string" ? data.email : null,
      name:
        typeof data.fullName === "string"
          ? data.fullName
          : typeof data.name === "string"
            ? data.name
            : null,
      role: "super_admin",
      businessId: null,
    };
  }

  const customerSnap = await adminDb.collection("customers").doc(uid).get();
  if (customerSnap.exists) {
    const data = customerSnap.data() ?? {};
    return {
      uid,
      email: typeof data.email === "string" ? data.email : null,
      name: typeof data.fullName === "string" ? data.fullName : null,
      role: "customer",
      businessId:
        typeof data.registeredBusinessId === "string"
          ? data.registeredBusinessId
          : null,
    };
  }

  return { uid, email: null, name: null, role: "system", businessId: null };
}

export { actorRoleFromClaim };
