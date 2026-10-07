import { createHash } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { buildOnboardingCareplusPayload } from "@/lib/participant-onboarding/careplus-payload";
import { getCareplusIntegration } from "@/lib/integrations/careplus/mapping";
import { isCareplusSecretConfigured } from "@/lib/integrations/careplus/config";
import { CAREPLUS_OUTBOX_COLLECTION } from "@/lib/integrations/careplus/constants";
import { deliverCareplusOutboxEvent } from "@/lib/integrations/careplus/outbox";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { validateOnboarding } from "@/lib/participant-onboarding/types";

export const runtime = "nodejs";
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const recordsFor = (businessId: string) => adminDb.collection("participant_onboarding").doc(businessId).collection("records");
const errorResponse = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });
async function authorize(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return auth;
  if (auth.role !== "owner" && auth.role !== "admin") return { ok: false as const, status: 403, error: "Business owner or admin access required." };
  return auth;
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return errorResponse(auth.error, auth.status);
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  const cursor = params.get("cursor");
  if ((id && !validId(id)) || (cursor && !validId(cursor))) return errorResponse("Invalid record reference.", 400);
  try {
    const records = recordsFor(auth.businessId);
    if (id) {
      const snapshot = await records.doc(id).get();
      if (!snapshot.exists) return errorResponse("Onboarding record not found.", 404);
      return NextResponse.json({ ok: true, record: { ...snapshot.data(), id: snapshot.id } }, { headers: { "Cache-Control": "no-store" } });
    }
    let query = records.orderBy("updatedAt", "desc").select("participantName", "participantReference", "status", "updatedAt", "revision").limit(51);
    if (cursor) {
      const last = await records.doc(cursor).get();
      if (!last.exists) return errorResponse("Invalid page reference. Refresh the list.", 400);
      query = query.startAfter(last);
    }
    const snapshot = await query.get();
    const page = snapshot.docs.slice(0, 50);
    return NextResponse.json({
      ok: true, records: page.map((doc) => ({ ...doc.data(), id: doc.id })),
      nextCursor: snapshot.docs.length > 50 ? page[page.length - 1].id : null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[participant-onboarding] Read failed", error);
    return errorResponse("Could not load onboarding records.", 500);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return errorResponse(auth.error, auth.status);
  let body: Record<string, unknown>;
  let input;
  try {
    if (Number(request.headers.get("content-length") || 0) > 500000) return errorResponse("This form is too large.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 500000) return errorResponse("This form is too large.", 413);
    body = JSON.parse(text);
    input = validateOnboarding(body);
    if (body.id !== undefined && !validId(body.id)) return errorResponse("Invalid record reference.", 400);
    if (body.id && (!Number.isInteger(body.revision) || Number(body.revision) < 1)) return errorResponse("Invalid record version.", 400);
  } catch (error) {
    return errorResponse(error instanceof SyntaxError ? "Invalid request data." : error instanceof Error ? error.message : "Invalid form data.", 400);
  }
  try {
    const id = validId(body.id) ? body.id : randomUUID();
    const ref = recordsFor(auth.businessId).doc(id);
    const mapping = await getCareplusIntegration(auth.businessId);
    const connected = mapping?.status === "active" && isCareplusSecretConfigured(auth.businessId);
    const record = await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (body.id && !snapshot.exists) throw new Error("NOT_FOUND");
      const previous = snapshot.data();
      if (body.id && previous?.revision !== body.revision) throw new Error("CONFLICT");
      const now = new Date().toISOString();
      const data = {
        ...input, revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || now, updatedAt: now,
        createdBy: previous?.createdBy || auth.uid, updatedBy: auth.uid,
      };
      transaction.set(ref, data);
      if (connected) {
        const payload = buildOnboardingCareplusPayload(auth.businessId, { ...data, id });
        const rawBody = JSON.stringify(payload);
        transaction.create(adminDb.collection(CAREPLUS_OUTBOX_COLLECTION).doc(payload.eventId), {
          eventId: payload.eventId, businessId: auth.businessId, eventType: payload.eventType,
          jobId: id, payloadHash: createHash("sha256").update(rawBody).digest("hex"), rawBody,
          status: "pending", attempts: 0, nextAttemptAt: Timestamp.fromMillis(Date.now()),
          lastStatus: null, lastErrorCode: null, processingStatus: null,
          careplusRecordId: null, careplusResource: null, corrections: [], origin: "tenant",
          createdAt: FieldValue.serverTimestamp(), sentAt: null,
        });
      }
      return { ...data, id };
    });
    let careplusSync: "sent" | "pending" | "failed" | "not_connected" = connected ? "pending" : "not_connected";
    if (connected) {
      try {
        const result = await deliverCareplusOutboxEvent(buildOnboardingCareplusPayload(auth.businessId, record).eventId, { ignoreBackoff: true });
        if (result === "sent") {
          const delivered = await adminDb.collection(CAREPLUS_OUTBOX_COLLECTION)
            .doc(buildOnboardingCareplusPayload(auth.businessId, record).eventId).get();
          const receipt = delivered.data();
          careplusSync = receipt?.careplusResource === "participants" && receipt?.careplusRecordId
            && ["applied", "processed", "duplicate"].includes(receipt.processingStatus)
            ? "sent" : ["rejected", "correction_required"].includes(receipt?.processingStatus) ? "failed" : "pending";
        }
        if (result === "failed") careplusSync = "failed";
      } catch {
        // The event was stored atomically with the form; the existing worker retries it.
      }
    }
    return NextResponse.json({ ok: true, record, careplusSync }, { status: body.id ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_FOUND") return errorResponse("Onboarding record not found.", 404);
    if (error instanceof Error && error.message === "CONFLICT") return errorResponse("Another user updated this record. Reopen the saved version before saving again.", 409);
    console.error("[participant-onboarding] Save failed", error);
    return errorResponse("Could not save onboarding. Your edits are still in the form.", 500);
  }
}

