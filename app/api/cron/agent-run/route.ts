import { runAgent } from "@/lib/ai/agent/agent";
import { agentFlags } from "@/lib/ai/agent/config";
import { AGENT_HANDLERS } from "@/lib/ai/agent/handlers";
import { scanComplaintDeadlines } from "@/lib/ai/email/complaints/deadlines";
import { scanSafetyAcknowledgements } from "@/lib/ai/email/safety";
import { emailComplaintsEnabled, emailTriageAvailable } from "@/lib/ai/email/settings";
import { adminDb } from "@/lib/firebase/admin";
import { resolveBusinessOwnerUid, sendOwnerMobilePush, sendStaffMobilePush } from "@/lib/notifications/push";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  if (request.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return request.headers.get("x-cron-secret")?.trim() === secret;
}

/**
 * Every 5 minutes: Sophie's runner works through pending events (docs/sophie-autonomous-agent-plan.md
 * §4.3). Rollback: set AI_AGENT_ENABLED=false and it stops for every business, keeping every record.
 * While AI_AGENT_DRY_RUN is on (the default) handlers only log what they would do.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }
  const flags = agentFlags();
  if (!flags.enabled) return NextResponse.json({ ok: true, skipped: "disabled" });

  try {
    const result = await runAgent({ db: adminDb, resolveOwnerUid: resolveBusinessOwnerUid, handlers: AGENT_HANDLERS, flags });
    // Complaint deadlines (§10.9 step 9): technicians' questions, reminders and overdue cases. Live runs only.
    const complaints = emailComplaintsEnabled() && !flags.dryRun
      ? await scanComplaintDeadlines(adminDb, {
        push: (uid, push) => sendStaffMobilePush({ uid, ...push }),
        async pushOwner(businessId, push) {
          const ownerUid = await resolveBusinessOwnerUid(businessId);
          if (ownerUid) await sendOwnerMobilePush({ ownerUid, ...push });
        },
      }, Date.now()).catch((error) => { console.error("[cron/agent-run] complaint scan failed", (error as Error)?.name); return null; })
      : null;
    // A safety email keeps pushing the owner until they answer its card (§10.5).
    const safety = emailTriageAvailable() && !flags.dryRun
      ? await scanSafetyAcknowledgements(adminDb, async (businessId, push) => {
        const ownerUid = await resolveBusinessOwnerUid(businessId);
        if (ownerUid) await sendOwnerMobilePush({ ownerUid, ...push });
      }, Date.now()).catch((error) => { console.error("[cron/agent-run] safety scan failed", (error as Error)?.name); return null; })
      : null;
    return NextResponse.json({ ok: true, dryRun: flags.dryRun, ...result, complaints, safetyPushes: safety });
  } catch (error) {
    console.error("[cron/agent-run] failed", (error as Error)?.name);
    return NextResponse.json({ ok: false, error: "Agent run failed." }, { status: 500 });
  }
}
