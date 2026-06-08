/**
 * Super-admin audit log read API.
 *
 * GET /api/admin/audit-logs
 *
 * Returns recorded tenant activity (inspections, quotations, bookings, staff,
 * customers, services, items) newest-first. Super admin access only.
 *
 * Query parameters (all optional):
 *   businessId  — only events for one tenant
 *   category    — auth | inspection | quotation | booking | staff | customer | service | item
 *   source      — admin_panel | customer_portal | booking_engine | mobile_app | system
 *   limit       — max rows (1–500, default 200)
 *
 * Response: { ok: true, total: number, logs: AuditLogEntry[] }
 */

import { listAuditLogs } from "@/lib/audit/server";
import { parseAuditCategory, parseAuditSource } from "@/lib/audit/types";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId")?.trim() || null;
  const category = parseAuditCategory(url.searchParams.get("category"));
  const source = parseAuditSource(url.searchParams.get("source"));
  const limitParam = Number.parseInt(
    url.searchParams.get("limit") ?? "",
    10,
  );
  const limit = Number.isFinite(limitParam) ? limitParam : 200;

  const logs = await listAuditLogs({ businessId, category, source, limit });

  return NextResponse.json({ ok: true, total: logs.length, logs });
}
