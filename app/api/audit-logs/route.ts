/**
 * Scoped audit log read API for super admins, business members, and customers.
 *
 * GET /api/audit-logs
 *
 * Super admin — all tenants (optional businessId filter).
 * Owner / staff — own business only.
 * Customer — own sign-ins and activity for the booking business (bookingSlug query).
 */

import { listAuditLogs } from "@/lib/audit/server";
import {
  matchesAuditCategoryFilter,
  normalizeAuditLogEntries,
  parseAuditCategory,
  parseAuditSource,
} from "@/lib/audit/types";
import { resolveAuditLogAccess } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const bookingSlug = url.searchParams.get("bookingSlug")?.trim() || null;

  const access = await resolveAuditLogAccess(request, { bookingSlug });
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const category = parseAuditCategory(url.searchParams.get("category"));
  const source = parseAuditSource(url.searchParams.get("source"));
  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitParam) ? limitParam : 200;

  let businessId: string | null = null;
  let participantUid: string | null = null;

  if (access.scope === "platform") {
    businessId = url.searchParams.get("businessId")?.trim() || null;
  } else if (access.scope === "tenant") {
    businessId = access.businessId;
  } else {
    businessId = access.businessId;
    participantUid = access.uid;
  }

  const tenantOwnerView = access.scope === "tenant";

  let logs = await listAuditLogs({
    businessId,
    category: tenantOwnerView ? null : category,
    source,
    participantUid,
    limit: tenantOwnerView ? 500 : limit,
  });

  logs = normalizeAuditLogEntries(logs);

  if (tenantOwnerView && category) {
    logs = logs.filter((entry) =>
      matchesAuditCategoryFilter(entry, category, true),
    );
  }

  logs = logs.slice(0, limit);

  return NextResponse.json({
    ok: true,
    scope: access.scope,
    total: logs.length,
    logs,
  });
}
