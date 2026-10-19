/**
 * GET — current status of one queued email, for progress polling.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import { getOutboxItem } from "@/lib/email-integration/outbox";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/email/outbox/[id]">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const item = await getOutboxItem(auth.businessId, id);
  if (!item) return emailError(404, "Email not found.");
  return NextResponse.json({ ok: true, item });
}
