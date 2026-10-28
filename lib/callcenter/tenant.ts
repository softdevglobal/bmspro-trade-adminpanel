import "server-only";

import { NextResponse } from "next/server";
import type { AuditActor } from "@/lib/audit/types";
import { requireBookingBusiness } from "@/lib/callcenter/booking-access";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Tenant (business) resolution for the `/api/call-center/*` routes.
 *
 * The business id can come from (first match wins):
 *   1. `X-Tenant-Id` header  — what Command Center sends
 *   2. `?businessId=` / `?tenantId=` / `?ownerUid=` query
 *   3. `businessId` / `tenantId` / `ownerUid` in a JSON body
 */
export function readTenantId(
  request: Request,
  body?: Record<string, unknown> | null,
): string {
  const header = request.headers.get("x-tenant-id")?.trim();
  if (header) return header;
  const query = new URL(request.url).searchParams;
  for (const key of ["businessId", "tenantId", "ownerUid"]) {
    const value = query.get(key)?.trim();
    if (value) return value;
  }
  for (const key of ["businessId", "tenantId", "ownerUid"]) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export type CallCenterTenantAuth = Extract<
  Awaited<ReturnType<typeof requireBookingBusiness>>,
  { ok: true }
> & { actor: AuditActor };

/**
 * Agent / super admin / AI receptionist auth plus business scope check.
 * `humanOnly` rejects the AI receptionist (it may only read and create).
 */
export async function requireCallCenterTenant(
  request: Request,
  options: {
    body?: Record<string, unknown> | null;
    humanOnly?: boolean;
    /** Use this business instead of reading header/query/body (e.g. from a looked-up doc). */
    businessId?: string;
  } = {},
): Promise<
  | CallCenterTenantAuth
  | { ok: false; status: number; error: string }
> {
  const businessId = options.businessId ?? readTenantId(request, options.body);
  if (!businessId) {
    if (!request.headers.get("authorization")) {
      return { ok: false, status: 401, error: "Missing authorization header." };
    }
    return {
      ok: false,
      status: 400,
      error: "Missing businessId (X-Tenant-Id header or ?businessId=).",
    };
  }
  const auth = await requireBookingBusiness(request, businessId);
  if (!auth.ok) return auth;
  if (options.humanOnly && auth.isAi) {
    return {
      ok: false,
      status: 403,
      error: "The AI receptionist cannot perform this action.",
    };
  }
  const name = auth.name ?? (await lookupUserName(auth.uid)) ?? auth.email;
  return {
    ...auth,
    name,
    actor: { uid: auth.uid, role: "call_center", name, email: auth.email },
  };
}

async function lookupUserName(uid: string): Promise<string | null> {
  const [user, agent] = await Promise.all([
    adminDb.collection("users").doc(uid).get(),
    adminDb.collection("call_center_agents").doc(uid).get(),
  ]);
  for (const data of [agent.data(), user.data()]) {
    for (const key of ["fullName", "displayName", "name"]) {
      const value = data?.[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

/** `{ ok: false, error }` with the given status — the Trade API error shape. */
export function callCenterError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error, ...extra }, { status });
}

/** Parses a JSON object body; an empty body becomes `{}`. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Integer query param clamped to [min, max]; `fallback` when missing/invalid. */
export function intParam(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

/** Business ids a human agent may work with (assigned list + primary). */
export async function agentBusinessIds(uid: string): Promise<string[]> {
  const agent = (await adminDb.collection("call_center_agents").doc(uid).get()).data();
  if (!agent) return [];
  const ids = new Set<string>();
  if (typeof agent.workshopOwnerUid === "string" && agent.workshopOwnerUid) {
    ids.add(agent.workshopOwnerUid);
  }
  if (Array.isArray(agent.assignedBusinessIds)) {
    for (const id of agent.assignedBusinessIds) {
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids];
}

/** Splits ids into Firestore `in` query chunks (max 30 values). */
export function chunk<T>(items: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
