import "server-only";
import { verifyAccountIdToken } from "@/lib/auth/account-access";
import { requireCallCenterAgent } from "@/lib/callcenter/auth";
import { bookingAgentCanAccess } from "@/lib/callcenter/booking-scope";
import { adminDb } from "@/lib/firebase/admin";
import { isTenantAccessAllowed } from "@/lib/onboarding/business-status";

export async function requireBookingBusiness(request: Request, rawBusinessId: unknown) {
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token) return { ok: false as const, status: 401, error: "Missing authorization header." };
  let decoded;
  try { decoded = await verifyAccountIdToken(token); }
  catch { return { ok: false as const, status: 401, error: "Invalid or expired session." }; }
  const businessId = typeof rawBusinessId === "string" ? rawBusinessId.trim() : "";
  if (!/^[^/]{1,128}$/.test(businessId) || [".", ".."].includes(businessId)) {
    return { ok: false as const, status: 400, error: "A valid businessId is required." };
  }
  let superAdmin = false;
  if (decoded.role !== "ai_receptionist" && decoded.aiFrontOffice !== true) {
    const human = await requireCallCenterAgent(request);
    if (!human.ok) return human;
    superAdmin = human.isSuperAdmin;
  }
  const agent = (await adminDb.collection("call_center_agents").doc(decoded.uid).get()).data();
  if (!bookingAgentCanAccess(decoded.uid, { role: decoded.role, aiFrontOffice: decoded.aiFrontOffice, brand: decoded.brand }, agent, businessId, superAdmin)) {
    return { ok: false as const, status: 403, error: "The booking agent is not assigned to this business." };
  }
  const business = (await adminDb.collection("businesses").doc(businessId).get()).data();
  if (!business || !isTenantAccessAllowed(business.status, business.isActive)) {
    return { ok: false as const, status: 403, error: "This business is unavailable." };
  }
  return { ok: true as const, uid: decoded.uid, businessId, business,
    isAi: agent?.accountType === "ai-front-office", email: decoded.email ?? null,
    name: typeof agent?.name === "string" ? agent.name : null,
    timeZone: typeof business.timezone === "string" && business.timezone ? business.timezone : "Australia/Melbourne" };
}
