import "server-only"; // build error if this file is ever imported into browser code
import { adminDb } from "@/lib/firebase/admin"; // Firestore with admin rights
import { logAuditEvent } from "@/lib/audit/server"; // your audit log writer
import { createBusinessService, getBusinessTradeType } from "@/lib/onboarding/services/server"; // same create logic as POST /api/services
import { consumeRateLimits } from "@/lib/security/rate-limit"; // per-key limiter
import {
  checkCreate, OWNER_SERVICE_LIMITS as L, prepareServiceInput,
} from "@/lib/ai/owner-call/owner-service"; // shared rules (Step 1)

// Server-only collection, listed in firestore.rules (Step 6)
const DRAFTS = "ai_owner_service_drafts";

// Who is acting. Always taken from the login on the route, never from tool arguments.
export type ServiceOwner = { businessId: string; uid: string; email: string | null };

export function ownerServiceTools(owner: ServiceOwner) {
  // One pending draft per owner per business: a new prepare replaces the old one
  const ref = adminDb.collection(DRAFTS).doc(`${owner.businessId}_${owner.uid}`);

  return {
    // prepare_service: validate and store the draft. Creates no service.
    async prepare(args: unknown) {
      const parsed = prepareServiceInput.safeParse(args); // never trust model input
      if (!parsed.success) {
        return { status: "REJECTED", message: `Send a name, ${L.minMinutes}-${L.maxMinutes} minutes and 1-${L.maxTasks} steps with titles.` };
      }
      const tasks = parsed.data.tasks.map((t) => ({ title: t.title, description: t.description ?? "" })); // fill optional descriptions
      await ref.set({
        businessId: owner.businessId, uid: owner.uid, // who owns this draft
        name: parsed.data.name, durationMin: parsed.data.durationMin, tasks, // what will be created
        createdAt: Date.now(), // starts the review timer
      });
      return {
        status: "READY_TO_CONFIRM", // tells the model nothing was created yet
        name: parsed.data.name, durationMin: parsed.data.durationMin, tasks, // echoed back for the read-back
        message: "Nothing is created yet. Read back the name, duration and steps, then ask: Should I add this service?",
      };
    },

    // create_service: claim the stored draft and create the live service
    async create(args: unknown) {
      const confirmed = (args as { confirmed?: unknown } | null)?.confirmed; // model's confirmation flag

      // Rate limit writes separately from the 30/min read limit on the route
      if (!await consumeRateLimits([{ key: `owner-voice:service:${owner.uid}`, limit: L.createsPerHour, windowMs: 3_600_000 }])) {
        return { status: "LIMIT_REACHED", message: "Too many services added by voice this hour. Ask the owner to use the Services page." };
      }

      // Read and delete the draft in one transaction, so two create calls can never both use it
      let claimed: { name: string; durationMin: number; tasks: { title: string; description: string }[] } | null = null;
      let refusal: { status: string; message: string } | null = null;
      await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref); // current draft, if any
        const data = snap.data() as { name: string; durationMin: number; tasks: { title: string; description: string }[]; createdAt: number } | undefined;
        const decision = checkCreate(data ?? null, confirmed, Date.now()); // shared rules (Step 1)
        if (!decision.ok) { refusal = { status: decision.status, message: decision.message }; return; } // leave the draft for a retry
        claimed = { name: data!.name, durationMin: data!.durationMin, tasks: data!.tasks }; // what is created is what was stored
        tx.delete(ref); // one draft, one service
      });
      if (refusal) return refusal; // a rule failed
      if (!claimed) return { status: "NO_DRAFT", message: "Nothing is prepared. Call prepare_service first." }; // safety net
      const draft = claimed as { name: string; durationMin: number; tasks: { title: string; description: string }[] };

      // Same trade logic as the wizard: the business's trade, else "General"
      const trade = (await getBusinessTradeType(owner.businessId))?.trim() || "General";

      // Same function POST /api/services uses, so validation and stored shape match exactly
      const result = await createBusinessService(owner.businessId, {
        source: "custom", templateId: null, // not from a template
        name: draft.name, businessType: trade, requiredSkill: trade,
        defaultDurationMin: draft.durationMin,
        isActive: true, imageUrl: null, // live straight away, as you asked
        tasks: draft.tasks,
      });
      if (!result.ok) {
        return { status: "FAILED", message: `It was not added: ${result.error} Prepare it again or use the Services page.` }; // draft already used, so prepare again
      }

      // Audit entry, same fields as /api/services, marked as voice in metadata
      await logAuditEvent({
        businessId: owner.businessId,
        category: "service",
        action: "service.created",
        actor: { uid: owner.uid, role: "owner", name: owner.email, email: owner.email },
        source: "admin_panel", // AuditSource has no voice value; the metadata below records voice
        summary: `Service "${result.service.name}" created by voice (Talk to Sophie)`,
        targetId: result.serviceId,
        targetLabel: result.service.name,
        metadata: { via: "owner_voice", taskCount: result.service.taskCount, isActive: result.service.isActive },
      });

      return {
        status: "CREATED", // tells the model it worked
        message: "The service is added and live. Tell the owner it is on the Services page, where they can edit or delete it.",
      };
    },
  };
}
