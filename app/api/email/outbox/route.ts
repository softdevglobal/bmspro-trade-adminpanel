/**
 * GET ?filter=all|attention|in_progress|accepted&cursor= — every email the
 * business has sent from its mailbox (quotes, invoices and tests), newest first.
 */

import { requireEmailSender } from "@/lib/email-integration/auth";
import {
  listBusinessEmails,
  parseEmailListFilter,
} from "@/lib/email-integration/outbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const result = await listBusinessEmails({
    businessId: auth.businessId,
    filter: parseEmailListFilter(searchParams.get("filter")),
    cursor: searchParams.get("cursor")?.trim() || null,
  });
  return NextResponse.json({ ok: true, ...result });
}
