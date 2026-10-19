import "server-only";

import { isEmailSendEnabled } from "@/lib/email-integration/config";
import { isCredentialKeyConfigured } from "@/lib/email-integration/crypto";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

/**
 * Stage 1 permission model: business owners and admins connect mailboxes and
 * send. Other staff (technicians) have no email permission by default.
 */
export async function requireEmailSender(
  request: Request,
): Promise<
  | { ok: true; uid: string; businessId: string }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) {
    return { ok: false, response: emailError(auth.status, auth.error) };
  }
  if (!isEmailSendEnabled(auth.businessId)) {
    return {
      ok: false,
      response: emailError(404, "Email sending is not enabled for this business."),
    };
  }
  if (!isCredentialKeyConfigured()) {
    return {
      ok: false,
      response: emailError(503, "Email sending is not configured on the server."),
    };
  }
  return { ok: true, uid: auth.uid, businessId: auth.businessId };
}

export function emailError(status: number, error: string, code?: string): NextResponse {
  return NextResponse.json(
    { ok: false, error, ...(code ? { code } : {}) },
    { status },
  );
}
