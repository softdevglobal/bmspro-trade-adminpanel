/**
 * DELETE — disconnects the mailbox: disables sending, holds queued work,
 * revokes the provider grant and deletes stored credentials.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import {
  disconnectEmailConnection,
  getEmailConnectionById,
} from "@/lib/email-integration/connections";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/email/connections/[id]">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const connection = await getEmailConnectionById(auth.businessId, id);
  if (!connection || connection.status === "disconnected") {
    return emailError(404, "Email connection not found.");
  }

  await disconnectEmailConnection(connection, auth.uid);
  return NextResponse.json({ ok: true });
}
