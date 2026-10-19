/**
 * GET — this business's customers with an email address, for compose
 * suggestions. Same sources as the Customers page; never another business's.
 */

import { requireEmailSender } from "@/lib/email-integration/auth";
import {
  customerContacts,
  loadBusinessMailContext,
} from "@/lib/email-integration/mailbox/directory";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;
  const context = await loadBusinessMailContext(auth.businessId);
  return NextResponse.json({ ok: true, contacts: customerContacts(context) });
}
