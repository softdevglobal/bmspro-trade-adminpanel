import "server-only";

import { verifyAccountIdToken } from "@/lib/auth/account-access";
import { adminDb } from "@/lib/firebase/admin";

/**
 * Who may create quotations: owners and admins, plus staff with the
 * `canget_qutaion` permission. Shared by the quotation routes.
 */
export async function requireQuotationAuthor(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header.",
    };
  }

  try {
    const decoded = await verifyAccountIdToken(match[1]);
    let businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    let role = typeof decoded.role === "string" ? decoded.role : null;

    if (!businessId || !role) {
      const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
      if (userSnap.exists) {
        const data = userSnap.data() ?? {};
        if (!businessId && typeof data.businessId === "string") {
          businessId = data.businessId;
        }
        if (!role && typeof data.role === "string") {
          role = data.role;
        }
      }
    }

    if (role === "business_owner") role = "owner";

    if (
      !businessId ||
      (role !== "staff" && role !== "owner" && role !== "admin")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "You do not have permission to create quotations.",
      };
    }

    if (role === "staff") {
      const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
      const canCreateQuotation =
        userSnap.exists && userSnap.data()?.canget_qutaion === true;
      if (!canCreateQuotation) {
        return {
          ok: false as const,
          status: 403,
          error: "You do not have permission to create quotations.",
        };
      }
    }

    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      name: typeof decoded.name === "string" ? decoded.name : null,
      role,
      businessId,
      restrictToOwnQuotations: role === "staff",
    };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }
}
