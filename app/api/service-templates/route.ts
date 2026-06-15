/**
 * Service templates read API (shared by super admin and business owners).
 *
 * GET — Super admin: all templates.
 *       Business owner: active templates matching their business trade type.
 */

import { requireBusinessMember } from "@/lib/onboarding/server";
import {
  getBusinessTradeType,
  listServiceTemplates,
  requireSuperAdmin,
} from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Lists templates. Business owners receive only active templates for their
 * trade type plus their businessType in the response.
 */
export async function GET(request: Request) {
  const superAdmin = await requireSuperAdmin(request);
  if (!superAdmin.ok) {
    const member = await requireBusinessMember(request);
    if (member.ok) {
      const businessType = await getBusinessTradeType(member.businessId);
      if (!businessType) {
        return NextResponse.json(
          { ok: false, error: "Could not load your business trade type." },
          { status: 400 },
        );
      }

      const result = await listServiceTemplates({
        activeOnly: true,
        businessType,
      });
      if (!result.ok) {
        return NextResponse.json(result, { status: 500 });
      }

      return NextResponse.json({
        ok: true,
        templates: result.templates,
        businessType,
      });
    }

    return NextResponse.json(
      { ok: false, error: member.error },
      { status: member.status },
    );
  }

  const result = await listServiceTemplates();
  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: result.templates });
}
