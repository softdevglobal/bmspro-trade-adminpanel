import { logAuditEvent } from "@/lib/audit/server";
import { CareplusClientError, fetchCareplusLearning } from "@/lib/integrations/careplus/client";
import { CAREPLUS_LEARNING_VIEWS } from "@/lib/integrations/careplus/types";
import { getCareplusIntegration, touchCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import { requireSuperAdmin } from "@/lib/onboarding/server";
import { FieldValue } from "firebase-admin/firestore";
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
  const businessId = url.searchParams.get("businessId")?.trim() ?? "";
  const view = url.searchParams.get("view")?.trim() ?? "";
  const cursor = url.searchParams.get("cursor");
  const learnerId = url.searchParams.get("learnerId");
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);

  if (!businessId) {
    return NextResponse.json(
      { ok: false, error: "businessId is required." },
      { status: 400 },
    );
  }
  if (!(CAREPLUS_LEARNING_VIEWS as readonly string[]).includes(view)) {
    return NextResponse.json(
      { ok: false, error: "view must be catalogue, learners, or activity." },
      { status: 400 },
    );
  }

  const mapping = await getCareplusIntegration(businessId);
  if (!mapping || mapping.status !== "active") {
    return NextResponse.json(
      { ok: false, error: "This tenant has no active CarePlus mapping." },
      { status: 403 },
    );
  }

  const started = Date.now();
  try {
    const result = await fetchCareplusLearning({
      businessId,
      view: view as (typeof CAREPLUS_LEARNING_VIEWS)[number],
      limit: Number.isFinite(limitRaw) ? limitRaw : 25,
      cursor,
      learnerId,
    });
    await touchCareplusIntegration(businessId, {
      lastLearningAt: FieldValue.serverTimestamp(),
      lastErrorCode: null,
    });
    await logAuditEvent({
      businessId,
      category: "integration",
      action: "careplus.learning_read",
      actor: {
        uid: auth.uid,
        role: "super_admin",
        name: null,
        email: auth.email ?? null,
      },
      source: "admin_panel",
      summary: `CarePlus ${view} read for ${businessId}`,
      targetId: businessId,
      metadata: {
        view,
        httpStatus: result.status,
        durationMs: Date.now() - started,
        hasNextCursor: Boolean(result.nextCursor),
      },
    });
    return NextResponse.json({
      ok: true,
      view,
      status: result.status,
      nextCursor: result.nextCursor,
      body: result.body,
    });
  } catch (error) {
    const status = error instanceof CareplusClientError ? error.status : 502;
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "CarePlus learning request failed.",
      },
      { status: status >= 400 && status < 600 ? status : 502 },
    );
  }
}
