import { expenseSource, jsonError, requireExpenseAccess } from "@/lib/expenses/route-auth";
import {
  createManualExpense,
  decideExpense,
  deleteDraftExpense,
  getExpense,
  isExpenseManager,
  listExpenses,
  markExpenseReimbursed,
  requestExpenseReceipt,
  submitExpense,
  updateExpenseFields,
  type ExpenseFieldsInput,
  type ExpenseResult,
} from "@/lib/expenses/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET    /api/expenses            owners: every expense; staff: their own
 * GET    /api/expenses?id=…       one expense
 * POST   /api/expenses            add an expense without a receipt (draft)
 * PATCH  /api/expenses            { id, action, fields?, note?, allowDuplicate? }
 * DELETE /api/expenses?id=…       delete a draft
 *
 * Approving, rejecting and recording reimbursements are owner/admin actions.
 * Sophie never approves or pays anything.
 */

function respond(result: ExpenseResult, successStatus = 200) {
  if (result.ok) return NextResponse.json({ ok: true, expense: result.expense }, { status: successStatus });
  return jsonError(result.status, result.error, result.duplicate ? { duplicate: result.duplicate } : {});
}

const FIELD_KEYS = ["vendor", "date", "amountAud", "gstAud", "category", "reason", "vehicleId", "jobId", "paidWith"] as const;

function pickFields(raw: unknown): ExpenseFieldsInput {
  const input = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fields: ExpenseFieldsInput = {};
  for (const key of FIELD_KEYS) if (key in input) fields[key] = input[key];
  return fields;
}

const noteFrom = (value: unknown) => (typeof value === "string" ? value : null);

export async function GET(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (id) {
      const expense = await getExpense(access.actor, id);
      return expense ? NextResponse.json({ ok: true, expense }) : jsonError(404, "Expense not found.");
    }
    const expenses = await listExpenses(access.actor);
    return NextResponse.json({
      ok: true,
      expenses,
      canManage: isExpenseManager(access.actor),
      spendingLimitAud: access.business.settings.spendingLimitAud,
    });
  } catch (error) {
    console.error("[expenses] list failed", error instanceof Error ? error.message : "unknown");
    return jsonError(500, "Could not load expenses.");
  }
}

export async function POST(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");
  const payload = body as Record<string, unknown>;
  const result = await createManualExpense(access.actor, access.business, {
    ...pickFields(payload),
    allowDuplicate: payload.allowDuplicate === true,
    source: expenseSource(request),
  });
  return respond(result, 201);
}

export async function PATCH(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError(400, "Invalid request body.");
  const payload = body as Record<string, unknown>;
  const id = typeof payload.id === "string" ? payload.id.trim() : "";
  if (!id) return jsonError(400, "Expense is required.");
  const source = expenseSource(request);
  const { actor, business } = access;

  switch (payload.action) {
    case "update":
      return respond(await updateExpenseFields(actor, business, id, pickFields(payload.fields), source));
    case "submit":
      return respond(await submitExpense(actor, business, id, { allowDuplicate: payload.allowDuplicate === true, source }));
    case "approve":
      return respond(await decideExpense(actor, id, "approve", noteFrom(payload.note), source));
    case "reject":
      return respond(await decideExpense(actor, id, "reject", noteFrom(payload.note), source));
    case "request_receipt":
      return respond(await requestExpenseReceipt(actor, id, noteFrom(payload.note), source));
    case "mark_reimbursed":
      return respond(await markExpenseReimbursed(actor, id, noteFrom(payload.note), source));
    default:
      return jsonError(400, "Unsupported expense action.");
  }
}

export async function DELETE(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) return jsonError(400, "Expense is required.");
  const result = await deleteDraftExpense(access.actor, id, expenseSource(request));
  return result.ok ? NextResponse.json({ ok: true }) : jsonError(result.status, result.error);
}
