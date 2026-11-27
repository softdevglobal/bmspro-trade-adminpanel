import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { runDecisionActions, type ActionDeps } from "@/lib/ai/email/actions";
import { notifyNewCard } from "@/lib/ai/email/cards";
import { classifyEmail } from "@/lib/ai/email/classify";
import { createEmailMemory } from "@/lib/ai/email/memory";
import { runSafetyReply } from "@/lib/ai/email/safety";
import { learnReplyTemplate } from "@/lib/ai/email/reply-learning";
import { learnFromSentEmail } from "@/lib/ai/email/style-learning";
import { emailReceivedHandler, type TriageDeps } from "@/lib/ai/email/triage";
import { createEmbedder } from "@/lib/ai/rag/embeddings";
import { knowledgeSettings } from "@/lib/ai/rag/settings";
import { EMAIL_OUTBOX_COLLECTION } from "@/lib/email-integration/config";
import { getEmailConnectionById, type EmailConnectionRecord } from "@/lib/email-integration/connections";
import { freshCredentials } from "@/lib/email-integration/credentials";
import type { ComplaintJob } from "@/lib/ai/email/complaints/find-job";
import { bookingScheduleDays, mapBookingDoc } from "@/lib/bookings/map-booking-doc";
import { createDirectJob } from "@/lib/bookings/server";
import { zonedDateTimeToUtcMs } from "@/lib/platform/zoned-datetime";
import { displayBookingCode } from "@/lib/reference-codes";
import { listApprovedLeaveForBusiness } from "@/lib/leave/server";
import { offDayIdsFromAvailability } from "@/lib/team/staff-availability";
import { loadCustomerContext } from "@/lib/email-integration/mailbox/customer-context";
import { loadBusinessMailContext } from "@/lib/email-integration/mailbox/directory";
import { extractAddresses, replyReferences } from "@/lib/email-integration/mailbox/parse";
import { defaultEmailContent, documentSendBlocker, loadEmailableDocument } from "@/lib/email-integration/documents";
import { enqueueDocumentEmail, enqueueMailboxMessage, processOutboxItem } from "@/lib/email-integration/outbox";
import { listBusinessClosuresInRange } from "@/lib/calendar/business-closures/server";
import { parseOpenDays, parseWorkingHoursFromBusiness } from "@/lib/calendar/working-hours";
import { markMessagesDeleted, updateMessageLabels } from "@/lib/email-integration/mailbox/store";
import { getMailboxAdapter } from "@/lib/email-integration/providers";
import { logAuditEvent } from "@/lib/audit/server";
import { loadBusinessWorkingHours } from "@/lib/calendar/slot-occupancy";
import { ensureCustomerAccount } from "@/lib/customer/server";
import { applyOwnerAction, createInspectionRequest } from "@/lib/inspection/server";
import { resolveBusinessOwnerUid, sendOwnerMobilePush } from "@/lib/notifications/push";
import { resolvePlatformTimeZone } from "@/lib/platform/timezone";

import type { AgentHandlers } from "./agent";

/**
 * The runner's handlers, wired to the real services (Firestore, the mailbox providers, OpenAI).
 * Kept apart from agent.ts so the runner can be tested without them.
 */

/** A business's customer list is read once a minute at most, not once per email. */
const CUSTOMERS_TTL_MS = 60_000;
const customerCache = new Map<string, { value: Promise<Map<string, Set<string>>>; expiresAt: number }>();

function cachedCustomers(businessId: string): Promise<Map<string, Set<string>>> {
  const hit = customerCache.get(businessId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = loadBusinessMailContext(businessId).then((context) => context.customers);
  value.catch(() => customerCache.delete(businessId));
  if (customerCache.size > 200) customerCache.clear();
  customerCache.set(businessId, { value, expiresAt: Date.now() + CUSTOMERS_TTL_MS });
  return value;
}

function emailTriageDeps(db: Firestore, ownerUid: string): TriageDeps {
  const memory = createEmailMemory(db);
  const records = new Map<string, EmailConnectionRecord>();
  const embedding = knowledgeSettings();
  return {
    db,
    embeddingModel: embedding.model,
    notify: (card) => notifyNewCard(db, (push) => sendOwnerMobilePush({ ownerUid, ...push }), card),
    async loadConnection(businessId, connectionId) {
      const record = await getEmailConnectionById(businessId, connectionId);
      if (record) records.set(record.id, record);
      return record;
    },
    async openMailbox(connection) {
      const record = records.get(connection.id) ?? await getEmailConnectionById(connection.businessId, connection.id);
      const adapter = record ? getMailboxAdapter(record.provider) : null;
      if (!record || !adapter || record.status !== "active" || !record.capabilities.includes("read")) return null;
      const credentials = await freshCredentials(record);
      if (!credentials.ok) return null;
      return {
        getHeaders: (id) => adapter.getHeaders(credentials.credentials, id),
        getBody: (id, maxChars) => adapter.getBody(credentials.credentials, id, maxChars),
      };
    },
    customers: cachedCustomers,
    async threadRecipients(businessId, threadId) {
      const snap = await db.collection(EMAIL_OUTBOX_COLLECTION)
        .where("businessId", "==", businessId)
        .where("providerThreadId", "==", threadId)
        .limit(10)
        .get();
      if (snap.empty) return null;
      return [...new Set(snap.docs.flatMap((doc) => {
        const snapshot = doc.get("payloadSnapshot") ?? {};
        return extractAddresses(...[...(snapshot.to ?? []), ...(snapshot.cc ?? [])].map(String));
      }))];
    },
    async embed(text) {
      const [vector] = await createEmbedder(embedding, fetch, { timeoutMs: 10_000, retries: 1, concurrency: 1 })([text]);
      return vector;
    },
    nearestExamples: (businessId, vector) => memory.nearest(businessId, vector),
    classify: (input) => classifyEmail(input),
  };
}

/** The services an email action uses (lib/ai/email/actions). Also used by the undo route. */
export function emailActionDeps(db: Firestore): ActionDeps {
  const memory = createEmailMemory(db);
  return {
    db,
    async mailbox(businessId, connectionId) {
      const record = await getEmailConnectionById(businessId, connectionId);
      const adapter = record ? getMailboxAdapter(record.provider) : null;
      if (!record || !adapter || record.status !== "active" || !record.capabilities.includes("modify")) return null;
      const fresh = await freshCredentials(record);
      if (!fresh.ok) return null;
      const credentials = fresh.credentials;
      return {
        moveToFolder: (ids, folder) => adapter.moveToFolder(credentials, ids, folder),
        restoreToInbox: (targets, folder) => adapter.restoreToInbox(credentials, targets, folder),
        setRead: (target, read) => adapter.threadAction(credentials, target.threadId, read ? "mark_read" : "mark_unread", [
          { id: target.id, folder: target.folder, fromSelf: false },
        ]).then(() => undefined),
        async refresh(ids) {
          for (const id of ids) {
            const metadata = await adapter.getMetadata(credentials, id);
            // An IMAP message moved to another folder gets a new id; its old copy is gone.
            if (metadata) await updateMessageLabels(record.id, metadata);
            else await markMessagesDeleted(record.id, [id]);
          }
        },
      };
    },
    async pushOwner(businessId, push) {
      const ownerUid = await resolveBusinessOwnerUid(businessId);
      if (ownerUid) await sendOwnerMobilePush({ ownerUid, ...push });
    },
    async timeZone(businessId) {
      const business = (await db.collection("businesses").doc(businessId).get()).data();
      return resolvePlatformTimeZone(typeof business?.timezone === "string" ? business.timezone : null);
    },
    async dayStart(businessId) {
      return (await loadBusinessWorkingHours(businessId)).startTime;
    },
    retireExample: (businessId, id) => memory.retire(businessId, id),

    async businessProfile(businessId) {
      const business = (await db.collection("businesses").doc(businessId).get()).data() ?? {};
      const ownerUid = typeof business.ownerUid === "string" ? business.ownerUid : await resolveBusinessOwnerUid(businessId);
      const owner = ownerUid ? (await db.collection("users").doc(ownerUid).get()).data() : null;
      const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
      return {
        name: text(business.businessName),
        phone: text(business.businessPhone),
        ownerFirstName: text(owner?.fullName)?.split(/\s+/)[0] ?? null,
      };
    },
    async complaintJobs(businessId, email) {
      const snap = await db.collection("jobs").where("businessId", "==", businessId).where("customer.email", "==", email).limit(30).get();
      const timeZone = await this.timeZone(businessId);
      return snap.docs
        .map((doc) => mapBookingDoc(doc.id, doc.data()))
        .filter((job) => job.businessId === businessId)
        .map((job): ComplaintJob => ({
          id: job.id,
          code: displayBookingCode({ id: job.id, bookingCode: job.bookingCode }),
          status: job.status,
          serviceName: job.serviceName ?? job.customRequest?.title ?? null,
          date: job.scheduledSlot?.date ?? (job.visitStartedAt ? new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(job.visitStartedAt)) : null),
          startTime: job.scheduledStartTime,
          endTime: job.scheduledEndTime,
          staffUid: job.assignedTo?.uid ?? null,
          staffName: job.assignedTo?.name ?? null,
          visitStartedAt: job.visitStartedAt,
          visitEndedAt: job.visitEndedAt,
          missedReason: job.missedReason,
          durationMinutes: job.estimatedDurationMinutes,
          address: [job.address?.street, job.address?.suburb, job.address?.postcode].map((part) => String(part ?? "").trim().toLowerCase()).filter(Boolean).join(", ") || null,
        }))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    },
    async staffSchedule(businessId, staffUid) {
      const [staff, business, leave] = await Promise.all([
        db.collection("users").doc(staffUid).get(),
        db.collection("businesses").doc(businessId).get(),
        listApprovedLeaveForBusiness(businessId),
      ]);
      if (!staff.exists || staff.data()?.businessId !== businessId) return null;
      const hours = parseWorkingHoursFromBusiness(business.data());
      const timeZone = resolvePlatformTimeZone(typeof business.data()?.timezone === "string" ? business.data()?.timezone : null);
      const leaveDates = new Set<string>();
      for (const item of leave) {
        if (item.requesterUid !== staffUid || !item.isFullDay || !item.fromDate || !item.toDate) continue;
        for (let day = item.fromDate, guard = 0; day <= item.toDate && guard < 62; guard++) {
          leaveDates.add(day);
          day = new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10);
        }
      }
      return { startTime: hours.startTime, endTime: hours.endTime, offDays: offDayIdsFromAvailability(staff.data()?.availability), leaveDates, timeZone };
    },
    async createReturnJob(input) {
      const original = (await db.collection("jobs").doc(input.originalJobId).get());
      if (!original.exists || original.data()?.businessId !== input.businessId) return { ok: false, error: "The original job isn't there any more." };
      const job = mapBookingDoc(original.id, original.data() ?? {});
      const [hour, minute] = [Number(input.startTime.slice(0, 2)), Number(input.startTime.slice(3, 5))];
      const [endHour, endMinute] = [Number(input.endTime.slice(0, 2)), Number(input.endTime.slice(3, 5))];
      const created = await createDirectJob(input.businessId, input.actorUid, {
        requestType: job.requestType,
        serviceId: job.serviceId,
        customRequest: job.customRequest ? { title: job.customRequest.title, description: job.customRequest.description } : null,
        customer: job.customer,
        address: job.address,
        customerNotes: null,
        // A no-charge return visit: nothing is priced here. The $0 accepted quote is how the platform records it.
        budgetAud: 0,
        slot: { date: input.date, timeRange: hour < 12 ? "morning" : "afternoon", startTime: input.startTime, endTime: input.endTime },
        startTime: input.startTime,
        endTime: input.endTime,
        estimatedDurationMinutes: Math.max(15, (endHour * 60 + endMinute) - (hour * 60 + minute)),
        note: `Return visit for ${displayBookingCode({ id: job.id, bookingCode: job.bookingCode })} (no charge). Booked from a complaint.`,
        assignedTo: job.assignedTo,
        requiredSkill: job.requiredSkill,
      }, { actor: sophieActor(input.actorUid), source: "system" });
      return created.ok
        ? { ok: true, jobId: created.booking.id, code: displayBookingCode({ id: created.booking.id, bookingCode: created.booking.bookingCode }) }
        : { ok: false, error: created.error };
    },
    async staffBusy(businessId, staffUid, fromDate, toDate) {
      const timeZone = await this.timeZone(businessId);
      const [jobs, requests] = await Promise.all([
        db.collection("jobs").where("businessId", "==", businessId).where("assignedTo.uid", "==", staffUid).limit(300).get(),
        db.collection("requests").where("businessId", "==", businessId).where("assignedTo.uid", "==", staffUid).limit(300).get(),
      ]);
      const busy: { start: number; end: number }[] = [];
      const add = (date: unknown, start: unknown, end: unknown) => {
        if (typeof date !== "string" || date < fromDate || date > toDate || typeof start !== "string" || typeof end !== "string") return;
        const from = zonedDateTimeToUtcMs(date, start, timeZone);
        const to = zonedDateTimeToUtcMs(date, end, timeZone);
        if (from !== null && to !== null && to > from) busy.push({ start: from, end: to });
      };
      for (const doc of jobs.docs) {
        const job = mapBookingDoc(doc.id, doc.data());
        if (!["scheduled", "ongoing", "awaiting"].includes(job.status)) continue;
        for (const day of bookingScheduleDays(job)) add(day.date, day.startTime, day.endTime);
      }
      for (const doc of requests.docs) {
        const data = doc.data();
        if (!["pending", "scheduled"].includes(String(data.status))) continue;
        add(data.scheduledSlot?.date, data.scheduledStartTime, data.scheduledEndTime);
      }
      return busy;
    },
    async staffCheckIns(businessId, staffUid) {
      const snap = await db.collection("staff_check_ins").where("staffId", "==", staffUid).where("businessId", "==", businessId).limit(100).get();
      const ms = (value: unknown) => (typeof value === "string" ? (Number.isFinite(Date.parse(value)) ? Date.parse(value) : null) : typeof value === "number" ? value : value && typeof (value as { toMillis?: unknown }).toMillis === "function" ? (value as { toMillis(): number }).toMillis() : null);
      return snap.docs.map((doc) => ({ checkInAt: ms(doc.get("checkInTime")), checkOutAt: ms(doc.get("checkOutTime")) }));
    },
    async customerRecords(businessId, email) {
      return loadCustomerContext(db, businessId, email, { customers: await cachedCustomers(businessId) });
    },
    async businessHours(businessId, fromDate, toDate) {
      const business = (await db.collection("businesses").doc(businessId).get()).data() ?? {};
      // Only hours the owner saved: the calendar's default window isn't the business's real hours.
      const saved = business.workingHours && typeof business.workingHours === "object" ? parseWorkingHoursFromBusiness(business) : null;
      const closures = await listBusinessClosuresInRange(businessId, fromDate, toDate);
      return {
        startTime: saved?.startTime ?? null,
        endTime: saved?.endTime ?? null,
        openDays: parseOpenDays(business.openDays),
        closedDates: closures.map((closure) => closure.date),
      };
    },
    async resendDocument(input) {
      const document = await loadEmailableDocument(input.businessId, input.documentType, input.documentId);
      if (!document) return { ok: false, reason: "not_found" };
      // Only to the address on record, and only when that's who asked.
      const onRecord = document.customerEmail?.trim().toLowerCase() ?? "";
      if (!onRecord || onRecord !== input.requester) return { ok: false, reason: "address_mismatch" };
      if (documentSendBlocker(document)) return { ok: false, reason: "not_sendable" };
      const content = defaultEmailContent(document);
      const queued = await enqueueDocumentEmail({
        businessId: input.businessId,
        actorId: input.actorUid,
        idempotencyKey: input.idempotencyKey,
        connectionId: input.connectionId,
        documentType: input.documentType,
        documentId: input.documentId,
        documentVersion: document.version,
        to: [document.customerEmail],
        cc: [],
        subject: content.subject,
        bodyText: content.bodyText,
        agent: { autoSubmitted: true },
      });
      if (!queued.ok) {
        if (queued.code === "idempotency_conflict") return { ok: false, reason: "already_queued" };
        if (queued.code === "needs_reconnect") return { ok: false, reason: "needs_reconnect" };
        if (queued.code === "not_sendable" || queued.code === "pdf_too_large") return { ok: false, reason: "not_sendable" };
        return { ok: false, reason: "failed", error: queued.error };
      }
      if (queued.created) await processOutboxItem(queued.outboxId).catch(() => null);
      return { ok: true, code: document.code };
    },
    async replyMailbox(businessId, connectionId) {
      const connection = await getEmailConnectionById(businessId, connectionId);
      if (!connection || connection.status !== "active" || !connection.capabilities.includes("send")) return null;
      return {
        async send(input) {
          const queued = await enqueueMailboxMessage({
            businessId,
            actorId: input.actorUid,
            idempotencyKey: input.idempotencyKey,
            connection,
            to: [input.to],
            cc: [],
            bcc: [],
            subject: input.subject,
            bodyText: input.bodyText,
            attachments: [],
            thread: {
              providerThreadId: input.replyTo.threadId,
              inReplyTo: input.replyTo.messageIdHeader,
              references: replyReferences(input.replyTo.references, input.replyTo.messageIdHeader),
              replyToProviderMessageId: input.replyTo.providerMessageId,
            },
            intent: "reply",
            // Sophie's own mail: never learnt from as the owner's, and marked as an automatic reply.
            agent: { autoSubmitted: true },
          });
          if (!queued.ok) return { ok: false, error: queued.error, code: queued.code };
          if (queued.created) await processOutboxItem(queued.outboxId).catch(() => null);
          const item = (await db.collection(EMAIL_OUTBOX_COLLECTION).doc(queued.outboxId).get()).data();
          return { ok: true, messageIdHeader: typeof item?.internetMessageId === "string" ? item.internetMessageId : null };
        },
      };
    },

    async ensureCustomer(input) {
      const account = await ensureCustomerAccount({
        email: input.email, fullName: input.fullName, phone: input.phone, businessId: input.businessId,
        // The customer didn't ask for an account: no welcome email, and an existing profile is never changed.
        sendWelcomeEmail: false, preserveExistingProfile: true, context: "inspection",
      });
      if (account.created) {
        await logAuditEvent({
          businessId: input.businessId, category: "customer", action: "customer.created",
          actor: sophieActor(input.actorUid), source: "system",
          summary: "Customer saved by Sophie from an email, with details the owner confirmed.",
          targetId: account.uid, targetLabel: input.fullName,
        });
      }
      return { uid: account.uid, created: account.created };
    },

    async findCustomer(businessId, email) {
      const snap = await db.collection("customers")
        .where("registeredBusinessId", "==", businessId)
        .where("email", "==", email.trim().toLowerCase())
        .limit(2)
        .get();
      return snap.size === 1 ? snap.docs[0].id : null;
    },

    async createRequest(input) {
      const result = await createInspectionRequest(input.businessId, input.request, {
        customerId: input.customerId,
        createdSource: "sophie_email",
        requestId: input.requestId,
        markers: { sophieEmailTriageId: input.triageId, sophieEmailKind: input.kind },
      });
      if (!result.ok) return result;
      if (!result.existing) {
        await logAuditEvent({
          businessId: input.businessId, category: "inspection", action: "inspection.created",
          actor: sophieActor(null), source: "system",
          summary: `${input.kind === "job_request" ? "Job request" : "Inspection request"} ${result.request.requestCode || result.request.id} added by Sophie from an email.`,
          targetId: result.request.id, targetLabel: result.request.customRequest?.title ?? null,
        });
      }
      return { ok: true, requestCode: result.request.requestCode, existing: result.existing === true };
    },

    async cancelRequest(input) {
      const snap = await db.collection("requests").doc(input.requestId).get();
      const data = snap.data();
      if (!snap.exists || data?.businessId !== input.businessId || data.sophieEmailTriageId !== input.triageId) {
        return { ok: false, reason: "That request isn't there any more." };
      }
      // Once someone confirmed or changed it, cancelling is the owner's call on the request itself.
      if (data.status !== "pending") return { ok: false, reason: "That request has moved on. Change it under Requests." };
      const result = await applyOwnerAction(input.requestId, input.businessId,
        { type: "cancel", note: "Added by Sophie from an email, then undone." },
        { actor: sophieActor(input.actorUid), source: "system" });
      return result.ok ? { ok: true } : { ok: false, reason: result.error };
    },
  };
}

function sophieActor(uid: string | null) {
  return { uid, role: uid ? "owner" as const : "system" as const, name: "Sophie (email)", email: null };
}

export const AGENT_HANDLERS: AgentHandlers = {
  "email.received": emailReceivedHandler(emailTriageDeps),
  // Two things are learnt from a sent email: the owner's greeting and sign-off, and replies that are much the same.
  "email.sent_by_owner": async (context) => {
    const style = await learnFromSentEmail(context.db, context.event.businessId, context.event.entityId, context.now);
    const reply = await learnReplyTemplate(context.db, context.event.businessId, context.event.entityId, context.now);
    return `${style}|${reply}`;
  },
  "email.safety": (context) => runSafetyReply(emailActionDeps(context.db), context.event.entityId, context.principal.ownerUid, context.now),
  "email.decided": (context) => runDecisionActions(emailActionDeps(context.db), context.event.entityId, context.now),
};
