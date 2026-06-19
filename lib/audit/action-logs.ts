import "server-only";

import { logAuditEvent } from "@/lib/audit/server";
import {
  customerNotificationToAuditEntry,
  type CustomerNotificationAuditInput,
} from "@/lib/audit/customer-notification-entries";
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

type CustomNotificationActor = {
  uid: string;
  email: string | null;
  name: string | null;
};

function platformSummary(platforms: { admin: boolean; mobile: boolean }): string {
  const parts: string[] = [];
  if (platforms.admin) parts.push("admin panel");
  if (platforms.mobile) parts.push("mobile app");
  return parts.length ? parts.join(" + ") : "no platform";
}

function audienceSummary(audience: "owners" | "all"): string {
  return audience === "all" ? "owners and staff" : "owners only";
}

/** Records a super-admin custom notification (broadcast) send. */
export async function logCustomNotificationSent(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
  audience: "owners" | "all";
  platforms: { admin: boolean; mobile: boolean };
  mobilePushCount: number;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await logAuditEvent({
    businessId: null,
    category: "custom_notification",
    action: "custom_notification.sent",
    actor: {
      uid: params.actor.uid,
      role: "super_admin",
      name: params.actor.name,
      email: params.actor.email,
    },
    source: "admin_panel",
    summary: `${who} sent custom notification "${params.title}" to ${audienceSummary(params.audience)} via ${platformSummary(params.platforms)}`,
    targetId: params.broadcastId,
    targetLabel: params.title,
    metadata: {
      audience: params.audience,
      platforms: params.platforms,
      mobilePushCount: params.mobilePushCount,
      collection: "admin_broadcasts",
    },
  });
}

/** Records recall or re-activation of a custom notification. */
export async function logCustomNotificationActiveChanged(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
  active: boolean;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await logAuditEvent({
    businessId: null,
    category: "custom_notification",
    action: params.active
      ? "custom_notification.reactivated"
      : "custom_notification.recalled",
    actor: {
      uid: params.actor.uid,
      role: "super_admin",
      name: params.actor.name,
      email: params.actor.email,
    },
    source: "admin_panel",
    summary: params.active
      ? `${who} re-activated custom notification "${params.title}"`
      : `${who} recalled custom notification "${params.title}"`,
    targetId: params.broadcastId,
    targetLabel: params.title,
    metadata: { active: params.active, collection: "admin_broadcasts" },
  });
}

/** Records permanent deletion of a custom notification. */
export async function logCustomNotificationDeleted(params: {
  actor: CustomNotificationActor;
  broadcastId: string;
  title: string;
}): Promise<void> {
  const who = params.actor.name?.trim() || params.actor.email?.trim() || "Super admin";
  await logAuditEvent({
    businessId: null,
    category: "custom_notification",
    action: "custom_notification.deleted",
    actor: {
      uid: params.actor.uid,
      role: "super_admin",
      name: params.actor.name,
      email: params.actor.email,
    },
    source: "admin_panel",
    summary: `${who} deleted custom notification "${params.title}"`,
    targetId: params.broadcastId,
    targetLabel: params.title,
    metadata: { collection: "admin_broadcasts" },
  });
}

/** Records a document written to the `customer_notifications` collection. */
export async function logCustomerNotificationCreated(
  params: CustomerNotificationAuditInput & {
    auditSource?: AuditSource;
    auditActor?: {
      uid?: string | null;
      role?: AuditActorRole;
      name?: string | null;
      email?: string | null;
    };
  },
): Promise<void> {
  const entry = customerNotificationToAuditEntry({
    ...params,
    createdAt: params.createdAt ?? Date.now(),
  });
  await logAuditEvent({
    businessId: entry.businessId,
    category: entry.category,
    action: entry.action,
    actor: {
      uid: entry.actorUid,
      role: entry.actorRole,
      name: entry.actorName,
      email: entry.actorEmail,
    },
    source: entry.source,
    summary: entry.summary,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel,
    metadata: {
      ...entry.metadata,
      synthesizedFromCollection: false,
    },
  });
}

export { actorRoleFromClaim };
