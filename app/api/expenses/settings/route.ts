import { logAuditEvent } from "@/lib/audit/server";
import { receiptAnalysisConfig } from "@/lib/expenses/receipt-analysis";
import { jsonError, requireExpenseAccess } from "@/lib/expenses/route-auth";
import {
  isExpenseManager,
  listExpenseJobs,
  saveExpenseSettings,
} from "@/lib/expenses/server";
import { normalizeExpenseSettingsPatch } from "@/lib/expenses/types";
import { adminDb } from "@/lib/firebase/admin";
import { platformTodayIso } from "@/lib/platform/timezone";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function listTeam(businessId: string) {
  const snapshot = await adminDb.collection("users").where("businessId", "==", businessId).limit(300).get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        uid: doc.id,
        name: typeof data.fullName === "string" && data.fullName.trim() ? data.fullName.trim() : "Team member",
        role: typeof data.role === "string" ? data.role : "",
      };
    })
    .filter((member) => ["staff", "owner", "admin", "business_owner"].includes(member.role))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * GET   /api/expenses/settings  settings, the vehicle list and the jobs a receipt can be linked to
 * PATCH /api/expenses/settings  owner/admin: spending limit, accountant email, vehicles, reports
 */
export async function GET(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const { actor, business } = access;
  const manager = isExpenseManager(actor);
  try {
    const todayIso = platformTodayIso(new Date(), business.timeZone);
    const [jobs, team] = await Promise.all([
      listExpenseJobs(actor, todayIso),
      manager ? listTeam(actor.businessId) : Promise.resolve([]),
    ]);
    const settings = business.settings;
    return NextResponse.json({
      ok: true,
      canManage: manager,
      todayIso,
      receiptReading: receiptAnalysisConfig() !== null,
      settings: manager
        ? settings
        : {
            spendingLimitAud: settings.spendingLimitAud,
            accountantEmail: null,
            vehicles: settings.vehicles,
            weeklyReport: settings.weeklyReport,
            monthlyReport: settings.monthlyReport,
          },
      jobs: jobs.map(({ id, label, date }) => ({ id, label, date })),
      team,
    });
  } catch (error) {
    console.error("[expenses] settings load failed", error instanceof Error ? error.message : "unknown");
    return jsonError(500, "Could not load expense settings.");
  }
}

export async function PATCH(request: Request) {
  const access = await requireExpenseAccess(request);
  if (!access.ok) return jsonError(access.status, access.error);
  const { actor, business } = access;
  if (!isExpenseManager(actor)) return jsonError(403, "Only the owner or an admin can change expense settings.");
  const body: unknown = await request.json().catch(() => null);
  const parsed = normalizeExpenseSettingsPatch(body, business.settings);
  if (!parsed.ok) return jsonError(400, parsed.error);
  await saveExpenseSettings(actor.businessId, parsed.value);
  await logAuditEvent({
    businessId: actor.businessId,
    category: "expense",
    action: "expense.settings_updated",
    actor: { uid: actor.uid, role: actor.role === "admin" ? "admin" : "owner", name: actor.name, email: actor.email },
    source: request.headers.get("x-bmspro-client") === "mobile" ? "mobile_app" : "admin_panel",
    summary: "Expense settings updated",
    targetId: actor.businessId,
    metadata: {
      spendingLimitAud: parsed.value.spendingLimitAud,
      vehicles: parsed.value.vehicles.length,
      accountantEmailSet: parsed.value.accountantEmail !== null,
      weeklyReport: parsed.value.weeklyReport,
      monthlyReport: parsed.value.monthlyReport,
    },
  });
  return NextResponse.json({ ok: true, settings: parsed.value });
}
