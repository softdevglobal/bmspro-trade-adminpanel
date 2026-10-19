/**
 * POST — syncs the mailbox now (rate limited per mailbox).
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import { getEmailConnectionById } from "@/lib/email-integration/connections";
import { syncMailbox } from "@/lib/email-integration/mailbox/sync";
import { getSyncStatus } from "@/lib/email-integration/mailbox/store";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/email/connections/[id]/sync">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const connection = await getEmailConnectionById(auth.businessId, id);
  if (!connection || connection.status === "disconnected") {
    return emailError(404, "Email connection not found.");
  }

  const body = (await request.json().catch(() => null)) as { continue?: unknown } | null;
  // The open Emails page continues the import step by step; only explicit
  // "Sync now" clicks are rate limited here (the lease still prevents overlap).
  const result = await syncMailbox(connection, { manual: body?.continue !== true });
  if (!result.ok) {
    if (result.code === "busy") return emailError(409, "A sync is already running.", "busy");
    if (result.code === "rate_limited") {
      return NextResponse.json(
        { ok: false, code: "rate_limited", error: "Gmail asked us to slow down.", status: await getSyncStatus(connection.id) },
        { status: 429 },
      );
    }
    if (result.code === "too_soon") {
      return emailError(429, "Please wait a few seconds before syncing again.", "too_soon");
    }
    if (result.code === "not_enabled") {
      return emailError(409, "Inbox access isn't enabled for this mailbox.", "not_enabled");
    }
    return emailError(502, "The mailbox could not be synced. Try again shortly.", result.code);
  }
  return NextResponse.json({
    ok: true,
    stored: result.stored,
    status: await getSyncStatus(connection.id),
  });
}
