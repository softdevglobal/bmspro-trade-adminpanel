/**
 * GET ?email= — what this business has with a customer: quotes, invoices,
 * jobs and site inspections. Only for addresses that are this business's
 * customers; never reveals another business's records.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import { loadCustomerContext } from "@/lib/email-integration/mailbox/customer-context";
import { loadBusinessMailContext } from "@/lib/email-integration/mailbox/directory";
import { adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!email || email.length > 320) return emailError(400, "Email is required.");

  const mail = await loadBusinessMailContext(auth.businessId);
  const customer = await loadCustomerContext(adminDb, auth.businessId, email, mail);
  if (!customer) return emailError(404, "Not a customer of this business.");
  return NextResponse.json({ ok: true, customer });
}
