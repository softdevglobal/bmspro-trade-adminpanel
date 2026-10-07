import { NextResponse } from "next/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { getCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import { CareplusClientError, fetchCareplusProviderProfile } from "@/lib/integrations/careplus/client";

export const runtime = "nodejs";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role !== "owner" && auth.role !== "admin") return json({ ok: false, error: "Business owner or admin access required." }, 403);
  if (new URL(request.url).search) return json({ ok: false, error: "This request does not accept a business or provider selector." }, 400);
  try {
    const integration = await getCareplusIntegration(auth.businessId);
    if (!integration || integration.status !== "active" || !integration.careplusProviderId) {
      return json({ ok: true, connected: false, profile: null });
    }
    const profile = await fetchCareplusProviderProfile(auth.businessId, integration.careplusProviderId);
    const current = await getCareplusIntegration(auth.businessId);
    if (!current || current.status !== "active" || current.careplusProviderId !== integration.careplusProviderId || current.mappingRevision !== integration.mappingRevision) {
      return json({ ok: false, error: "The CarePlus connection changed. Please try again." }, 409);
    }
    return json({ ok: true, connected: true, profile });
  } catch (error) {
    if (error instanceof CareplusClientError && error.status === 409) {
      return json({
        ok: false,
        error: "CarePlus could not confirm the connected business. Open the CarePlus Trade connection settings and reconnect the correct Trade business, then retry autofill.",
      }, 409);
    }
    if (error instanceof CareplusClientError && (error.status === 401 || error.status === 403)) {
      return json({ ok: false, error: "CarePlus rejected the connection credentials. Ask your administrator to check the CarePlus integration configuration." }, 502);
    }
    return json({ ok: false, error: "CarePlus business details could not be loaded. Enter provider details manually or try again." }, 502);
  }
}
