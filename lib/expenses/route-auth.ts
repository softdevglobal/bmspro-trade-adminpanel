import "server-only";

import {
  loadExpenseBusiness,
  resolveExpenseActor,
  type ExpenseActor,
  type ExpenseBusinessContext,
} from "@/lib/expenses/server";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { NextResponse } from "next/server";

export type ExpenseAccess =
  | { ok: true; actor: ExpenseActor; business: ExpenseBusinessContext }
  | { ok: false; status: number; error: string };

/** A signed-in owner, admin or staff member of a business with Expenses turned on. */
export async function requireExpenseAccess(request: Request): Promise<ExpenseAccess> {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return auth;
  const actor = await resolveExpenseActor({
    uid: auth.uid,
    email: auth.email ?? null,
    businessId: auth.businessId,
    role: auth.role,
  });
  if (!actor) return { ok: false, status: 403, error: "Business member access required." };
  const business = await loadExpenseBusiness(actor.businessId);
  if (!business) return { ok: false, status: 404, error: "Business not found." };
  if (!business.expensesEnabled) {
    return {
      ok: false,
      status: 403,
      error: "Expenses are turned off for this business. The owner can turn them on in Settings.",
    };
  }
  return { ok: true, actor, business };
}

/** The mobile app sends `x-bmspro-client: mobile`; everything else is the dashboard. */
export function expenseSource(request: Request): "admin_panel" | "mobile_app" {
  return request.headers.get("x-bmspro-client") === "mobile" ? "mobile_app" : "admin_panel";
}

export const jsonError = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, error, ...extra }, { status });
