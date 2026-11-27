import { expenseSource, jsonError, requireExpenseAccess } from "@/lib/expenses/route-auth";
import { addExpenseReceipt, MAX_RECEIPT_BYTES } from "@/lib/expenses/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/expenses/receipt (multipart)
 *   file            the receipt photo (JPEG, PNG or WebP, up to 5 MB)
 *   expenseId       optional: add the receipt to this expense instead of creating one
 *   jobId           optional: the job the purchase was for
 *   allowDuplicate  "true" when the person confirmed a similar expense is a different purchase
 *
 * Sophie reads the receipt and a draft expense is created for the person to
 * check and submit. An exact repeat of an image is always refused (409).
 */
export async function POST(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Invalid upload. Choose the receipt photo again.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return jsonError(400, "Choose a photo of the receipt.");
  if (file.size > MAX_RECEIPT_BYTES) return jsonError(413, "Receipt photos must be 5 MB or smaller.");
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  try {
    const result = await addExpenseReceipt(access.actor, access.business, {
      bytes: Buffer.from(await file.arrayBuffer()),
      expenseId: text("expenseId"),
      jobId: text("jobId"),
      allowDuplicate: text("allowDuplicate") === "true",
      source: expenseSource(request),
    });
    if (result.ok) return NextResponse.json({ ok: true, expense: result.expense }, { status: 201 });
    return jsonError(result.status, result.error, result.duplicate ? { duplicate: result.duplicate } : {});
  } catch (error) {
    console.error("[expenses] receipt failed", error instanceof Error ? error.message : "unknown");
    return jsonError(500, "Could not add the receipt. Try again.");
  }
}
