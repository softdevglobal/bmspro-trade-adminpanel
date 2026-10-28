import "server-only";

import type { DocumentSnapshot } from "firebase-admin/firestore";
import { chunk } from "@/lib/callcenter/tenant";
import { adminDb } from "@/lib/firebase/admin";
import { findApprovedLeaveBlocking } from "@/lib/leave/server";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";
import { listBusinessServices } from "@/lib/onboarding/services/server";
import { toMillis } from "@/lib/onboarding/services/display";
import { staffCanPerformService } from "@/lib/team/ai-assignment-planner";
import { staffIsOffOnDate } from "@/lib/team/staff-off-day-server";

/**
 * Read-only business data for call-center agents: workshops (businesses),
 * staff and services. On Trade a "workshop" is a `businesses/{businessId}` doc.
 */

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const INACTIVE = new Set(["inactive", "disabled", "suspended"]);

// ─── workshops ───────────────────────────────────────────────────────────────

export type WorkshopSummary = {
  businessId: string;
  name: string;
  email: string;
  phone: string;
  businessType: string;
  address: string | null;
  state: string;
  postcode: string;
  mainSuburb: string;
  serviceAreas: string[];
  bookingSlug: string | null;
  timezone: string;
  status: string;
  isActive: boolean;
};

export function mapWorkshop(snap: DocumentSnapshot): WorkshopSummary {
  const d = snap.data() ?? {};
  return {
    businessId: snap.id,
    name: str(d.businessName),
    email: str(d.businessEmail),
    phone: str(d.businessPhone),
    businessType: str(d.businessType),
    address: str(d.businessAddress) || null,
    state: str(d.state),
    postcode: str(d.postcode),
    mainSuburb: str(d.mainSuburb),
    serviceAreas: Array.isArray(d.serviceAreas)
      ? d.serviceAreas.map(str).filter(Boolean)
      : [],
    bookingSlug: str(d.bookingSlug) || null,
    timezone: str(d.timezone) || "Australia/Melbourne",
    status: str(d.status) || "pending_review",
    isActive: d.isActive !== false,
  };
}

/** Super admin → every business (max 500); agent → its assigned businesses. */
export async function listWorkshops(scope: { all: true } | { ids: string[] }): Promise<WorkshopSummary[]> {
  let snaps: DocumentSnapshot[];
  if ("all" in scope) {
    snaps = (await adminDb.collection("businesses").limit(500).get()).docs;
  } else {
    if (scope.ids.length === 0) return [];
    const refs = scope.ids.map((id) => adminDb.collection("businesses").doc(id));
    snaps = (await Promise.all(chunk(refs, 100).map((part) => adminDb.getAll(...part)))).flat();
  }
  return snaps
    .filter((snap) => snap.exists && isTenantAccessAllowed(snap.data()?.status, snap.data()?.isActive))
    .map(mapWorkshop)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── staff ───────────────────────────────────────────────────────────────────

export type StaffRow = {
  id: string;
  uid: string;
  fullName: string;
  email: string;
  phone: string | null;
  staffType: string | null;
  skills: string[];
  status: string;
  photoUrl: string | null;
  createdAt: number | null;
};

type RawStaff = { row: StaffRow; data: Record<string, unknown> };

function mapStaff(snap: DocumentSnapshot): RawStaff {
  const d = snap.data() ?? {};
  return {
    data: { ...d, id: snap.id },
    row: {
      id: snap.id,
      uid: snap.id,
      fullName: str(d.fullName) || "Unnamed Staff",
      email: str(d.email),
      phone: str(d.phone) || null,
      staffType: str(d.staffType) || null,
      skills: Array.isArray(d.skills) ? d.skills.map(str).filter(Boolean) : [],
      status: str(d.status) || "active",
      photoUrl: str(d.photoUrl) || str(d.avatarUrl) || null,
      createdAt: toMillis(d.createdAt),
    },
  };
}

function isActiveStaff(data: Record<string, unknown>): boolean {
  return data.isActive !== false && !INACTIVE.has(String(data.status));
}

async function loadStaff(businessId: string): Promise<RawStaff[]> {
  const snap = await adminDb.collection("users").where("businessId", "==", businessId).get();
  return snap.docs
    .map(mapStaff)
    .filter((s) => s.data.role === "staff")
    .sort((a, b) => a.row.fullName.localeCompare(b.row.fullName));
}

export async function listStaff(
  businessId: string,
  filters: { status?: string } = {},
): Promise<StaffRow[]> {
  const status = filters.status?.trim().toLowerCase();
  return (await loadStaff(businessId))
    .filter((s) => !status || s.row.status.toLowerCase() === status)
    .map((s) => s.row);
}

// ─── services ────────────────────────────────────────────────────────────────

export async function listServices(businessId: string, activeOnly: boolean) {
  const result = await listBusinessServices(businessId);
  if (!result.ok) throw new Error(result.error);
  return activeOnly ? result.services.filter((s) => s.isActive) : result.services;
}

/** Raw service doc (with id) when it belongs to the business. */
export async function getServiceDoc(
  serviceId: string,
  businessId: string,
): Promise<Record<string, unknown> | null> {
  if (!/^[^/]{1,128}$/.test(serviceId) || [".", ".."].includes(serviceId)) return null;
  const snap = await adminDb.collection("services").doc(serviceId).get();
  const data = snap.data();
  if (!data || data.businessId !== businessId) return null;
  return { ...data, id: snap.id };
}

/**
 * Staff who can take the service: active, matching the service's staff list
 * or required skill (everyone when the service sets neither), and — with a
 * date — not on approved full-day leave or a weekly off day.
 */
export async function listServiceStaff(
  businessId: string,
  service: Record<string, unknown>,
  date?: string,
): Promise<(StaffRow & { availableOnDate: boolean | null })[]> {
  const hasRule =
    (Array.isArray(service.staffIds) && service.staffIds.length > 0) || !!str(service.requiredSkill);
  const eligible = (await loadStaff(businessId)).filter(
    (s) => isActiveStaff(s.data) &&
      (hasRule || Array.isArray(s.data.serviceIds) ? staffCanPerformService(s.data, service) : true),
  );
  if (!date) return eligible.map((s) => ({ ...s.row, availableOnDate: null }));

  const checked = await Promise.all(
    eligible.map(async (s) => {
      const [leave, off] = await Promise.all([
        findApprovedLeaveBlocking(businessId, s.row.uid, date),
        staffIsOffOnDate(s.row.uid, date, businessId),
      ]);
      return { ...s.row, availableOnDate: !leave && !off };
    }),
  );
  return checked.filter((s) => s.availableOnDate);
}
