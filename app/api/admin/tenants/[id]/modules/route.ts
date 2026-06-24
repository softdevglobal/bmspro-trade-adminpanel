import {
  mergeModuleSettings,
  normalizeModuleSettingsPatch,
  parseBusinessModuleSettings,
} from "@/lib/business/module-settings";
import { requireSuperAdmin, updateTenantModules } from "@/lib/onboarding/server";
import { adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireSuperAdmin(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const businessId = id?.trim() ?? "";
  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "Tenant id is required." },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const raw =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).enabledModules
      : null;
  const parsed = normalizeModuleSettingsPatch(raw);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.error },
      { status: 400 },
    );
  }

  const snap = await adminDb.collection("businesses").doc(businessId).get();
  if (!snap.exists) {
    return NextResponse.json(
      { ok: false, error: "Tenant not found." },
      { status: 404 },
    );
  }

  const current = parseBusinessModuleSettings(snap.data());
  const merged = mergeModuleSettings(current, parsed.value);
  const result = await updateTenantModules(businessId, merged);
  if (!result.ok) {
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    businessId,
    enabledModules: merged,
  });
}
