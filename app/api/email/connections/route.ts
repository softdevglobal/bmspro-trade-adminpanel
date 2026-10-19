/**
 * GET — the business's mailbox connection (metadata only, never credentials)
 * and whether business-mailbox sending is enabled at all.
 */

import { isEmailSendEnabled } from "@/lib/email-integration/config";
import {
  getBusinessEmailConnection,
  toConnectionSummary,
} from "@/lib/email-integration/connections";
import { emailError } from "@/lib/email-integration/auth";
import { listConfiguredProviders } from "@/lib/email-integration/providers";
import { requireBusinessOwner } from "@/lib/onboarding/services/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireBusinessOwner(request);
  if (!auth.ok) return emailError(auth.status, auth.error);

  if (!isEmailSendEnabled(auth.businessId)) {
    return NextResponse.json({ ok: true, enabled: false, providers: [], connection: null });
  }

  const connection = await getBusinessEmailConnection(auth.businessId);
  return NextResponse.json({
    ok: true,
    enabled: true,
    providers: listConfiguredProviders(),
    connection: connection ? toConnectionSummary(connection) : null,
  });
}
