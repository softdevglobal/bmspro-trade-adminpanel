/**
 * POST { confirm_unknown? } — resumes a failed, held, blocked or unknown email
 * through the same sender identity.
 */

import { emailError, requireEmailSender } from "@/lib/email-integration/auth";
import { processOutboxItem, retryOutboxItem } from "@/lib/email-integration/outbox";
import { after, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/email/outbox/[id]/retry">,
) {
  const auth = await requireEmailSender(request);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as {
    confirm_unknown?: unknown;
    retry_generation?: unknown;
  } | null;

  if (body?.retry_generation !== undefined &&
      (typeof body.retry_generation !== "number" || !Number.isSafeInteger(body.retry_generation) || body.retry_generation < 0)) {
    return emailError(400, "Refresh email history before retrying.");
  }

  const result = await retryOutboxItem({
    businessId: auth.businessId,
    actorId: auth.uid,
    outboxId: id,
    confirmUnknown: body?.confirm_unknown === true,
    expectedRetryGeneration: typeof body?.retry_generation === "number" ? body.retry_generation : undefined,
  });
  if (!result.ok) return emailError(result.status, result.error, result.code);

  after(() => processOutboxItem(id).catch(() => undefined));
  return NextResponse.json({ ok: true, status: result.status }, { status: 202 });
}
