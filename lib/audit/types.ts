/**
 * Super-admin audit log — shared types and labels.
 *
 * Every meaningful tenant action (inspections, quotations, bookings, staff,
 * customers, services, items) is recorded as one document in the `audit_logs`
 * Firestore collection. The super admin reads them back through
 * `GET /api/admin/audit-logs` and the `/dashboard/audit-log` page.
 *
 * The log is append-only: events are written best-effort and never block or
 * fail the action that produced them.
 */

/** Firestore collection that stores audit events. */
export const AUDIT_COLLECTION = "audit_logs";

/** High-level area an event belongs to (drives the UI filter chips + icons). */
export const AUDIT_CATEGORIES = [
  "auth",
  "inspection",
  "quotation",
  "booking",
  "staff",
  "customer",
  "service",
  "item",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** Who performed the action. */
export const AUDIT_ACTOR_ROLES = [
  "super_admin",
  "owner",
  "admin",
  "staff",
  "customer",
  "call_center",
  "system",
] as const;
export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number];

/** Where the action came from — answers "customer portal or the admin itself". */
export const AUDIT_SOURCES = [
  "admin_panel",
  "customer_portal",
  "booking_engine",
  "mobile_app",
  "system",
] as const;
export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const CATEGORY_LABELS: Record<AuditCategory, string> = {
  auth: "Auth",
  inspection: "Inspection",
  quotation: "Quotation",
  booking: "Job",
  staff: "Staff",
  customer: "Customer",
  service: "Service",
  item: "Item",
};

export const CATEGORY_ICONS: Record<AuditCategory, string> = {
  auth: "login",
  inspection: "event_available",
  quotation: "request_quote",
  booking: "assignment",
  staff: "groups",
  customer: "group",
  service: "settings_suggest",
  item: "inventory_2",
};

export const ACTOR_ROLE_LABELS: Record<AuditActorRole, string> = {
  super_admin: "Super admin",
  owner: "Business owner",
  admin: "Admin",
  staff: "Staff",
  customer: "Customer",
  call_center: "Call-center agent",
  system: "System",
};

export const SOURCE_LABELS: Record<AuditSource, string> = {
  admin_panel: "Admin panel",
  customer_portal: "Customer portal",
  booking_engine: "Booking engine",
  mobile_app: "Mobile app",
  system: "System",
};

/** The party that performed an action. */
export type AuditActor = {
  uid: string | null;
  role: AuditActorRole;
  name: string | null;
  email: string | null;
};

/** Payload passed to `logAuditEvent`. */
export type AuditEventInput = {
  /** Tenant the action affects (null only for platform-level events). */
  businessId: string | null;
  category: AuditCategory;
  /** Dotted action key, e.g. "inspection.created", "staff.deleted". */
  action: string;
  actor: AuditActor;
  source: AuditSource;
  /** Human-readable one-line description shown in the feed. */
  summary: string;
  /** ID of the affected document (inspection id, staff uid, …). */
  targetId?: string | null;
  /** Short label for the target (service name, customer name, …). */
  targetLabel?: string | null;
  /** Extra structured context (counts, status, price, …). */
  metadata?: Record<string, unknown>;
};

/** Shape returned by the read API and rendered in the dashboard. */
export type AuditLogEntry = {
  id: string;
  businessId: string | null;
  businessName: string | null;
  category: AuditCategory;
  action: string;
  actorUid: string | null;
  actorRole: AuditActorRole;
  actorName: string | null;
  actorEmail: string | null;
  source: AuditSource;
  summary: string;
  targetId: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown>;
  createdAt: number | null;
};

/** Maps a raw Firebase custom-claim role to an audit actor role. */
export function actorRoleFromClaim(role: unknown): AuditActorRole {
  if (role === "super_admin") return "super_admin";
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "staff") return "staff";
  if (role === "call_center") return "call_center";
  if (role === "customer") return "customer";
  return "system";
}

function isAuditCategory(value: unknown): value is AuditCategory {
  return (
    typeof value === "string" &&
    (AUDIT_CATEGORIES as readonly string[]).includes(value)
  );
}

function isAuditSource(value: unknown): value is AuditSource {
  return (
    typeof value === "string" &&
    (AUDIT_SOURCES as readonly string[]).includes(value)
  );
}

export function parseAuditCategory(value: unknown): AuditCategory | null {
  return isAuditCategory(value) ? value : null;
}

export function parseAuditSource(value: unknown): AuditSource | null {
  return isAuditSource(value) ? value : null;
}

/** Legacy staff sessions were stored under Auth — show them under Staff instead. */
export function normalizeAuditLogEntries(
  entries: AuditLogEntry[],
): AuditLogEntry[] {
  return entries.map((entry) => {
    if (
      entry.category === "auth" &&
      entry.actorRole === "staff" &&
      (entry.action === "auth.login" || entry.action === "auth.logout")
    ) {
      return {
        ...entry,
        category: "staff",
        action: entry.action === "auth.login" ? "staff.login" : "staff.logout",
      };
    }
    return entry;
  });
}

/**
 * Business-owner Auth filter: owner, admin, and customer portal sign-ins.
 * Staff sign-ins belong under the Staff chip (see normalizeAuditLogEntries).
 */
export function isBusinessOwnerAuthEntry(entry: AuditLogEntry): boolean {
  if (entry.category !== "auth") return false;
  if (entry.actorRole === "staff") return false;
  return (
    entry.actorRole === "owner" ||
    entry.actorRole === "admin" ||
    entry.actorRole === "customer"
  );
}

export function matchesAuditCategoryFilter(
  entry: AuditLogEntry,
  category: AuditCategory | "all",
  tenantOwnerView: boolean,
): boolean {
  if (category === "all") return true;
  if (tenantOwnerView && category === "auth") {
    return isBusinessOwnerAuthEntry(entry);
  }
  return entry.category === category;
}
