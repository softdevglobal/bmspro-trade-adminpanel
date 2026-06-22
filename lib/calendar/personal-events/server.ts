import "server-only";

import { validateCalendarVisitWindow } from "@/lib/calendar/visit-window";
import { isBusinessClosedOnDate } from "@/lib/calendar/business-closures/server";
import { adminDb } from "@/lib/firebase/admin";
import {
  PERSONAL_EVENTS_COLLECTION,
  type CreatePersonalEventInput,
  type PersonalCalendarEvent,
} from "@/lib/calendar/personal-events/types";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

function mapPersonalEventDoc(
  id: string,
  data: FirebaseFirestore.DocumentData,
): PersonalCalendarEvent {
  const createdAt =
    data.createdAt instanceof Timestamp
      ? data.createdAt.toDate().toISOString()
      : null;
  const updatedAt =
    data.updatedAt instanceof Timestamp
      ? data.updatedAt.toDate().toISOString()
      : null;

  return {
    id,
    businessId: typeof data.businessId === "string" ? data.businessId : "",
    title: typeof data.title === "string" ? data.title : "Personal event",
    notes: typeof data.notes === "string" ? data.notes : null,
    date: typeof data.date === "string" ? data.date : "",
    startTime: typeof data.startTime === "string" ? data.startTime : "08:00",
    endTime: typeof data.endTime === "string" ? data.endTime : "09:00",
    createdByUid:
      typeof data.createdByUid === "string" ? data.createdByUid : "",
    createdAt,
    updatedAt,
  };
}

export async function listPersonalCalendarEvents(
  businessId: string,
): Promise<PersonalCalendarEvent[]> {
  const snapshot = await adminDb
    .collection(PERSONAL_EVENTS_COLLECTION)
    .where("businessId", "==", businessId)
    .limit(200)
    .get();

  return snapshot.docs
    .map((doc) => mapPersonalEventDoc(doc.id, doc.data() ?? {}))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.startTime.localeCompare(b.startTime);
    });
}

export async function createPersonalCalendarEvent(
  businessId: string,
  createdByUid: string,
  input: CreatePersonalEventInput,
): Promise<
  | { ok: true; event: PersonalCalendarEvent }
  | { ok: false; error: string }
> {
  const windowError = validateCalendarVisitWindow(
    input.startTime,
    input.endTime,
  );
  if (windowError) {
    return { ok: false, error: windowError };
  }

  if (await isBusinessClosedOnDate(businessId, input.date)) {
    return {
      ok: false,
      error:
        "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
    };
  }

  const ref = adminDb.collection(PERSONAL_EVENTS_COLLECTION).doc();
  const now = FieldValue.serverTimestamp();

  await ref.set({
    businessId,
    title: input.title,
    notes: input.notes ?? null,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    createdByUid,
    createdAt: now,
    updatedAt: now,
  });

  const snap = await ref.get();
  return {
    ok: true,
    event: mapPersonalEventDoc(ref.id, snap.data() ?? {}),
  };
}

export async function getPersonalCalendarEvent(
  businessId: string,
  eventId: string,
): Promise<PersonalCalendarEvent | null> {
  const snap = await adminDb
    .collection(PERSONAL_EVENTS_COLLECTION)
    .doc(eventId)
    .get();
  if (!snap.exists) return null;
  const event = mapPersonalEventDoc(snap.id, snap.data() ?? {});
  if (event.businessId !== businessId) return null;
  return event;
}

export async function updatePersonalCalendarEvent(
  businessId: string,
  eventId: string,
  input: CreatePersonalEventInput,
): Promise<
  | { ok: true; event: PersonalCalendarEvent }
  | { ok: false; status: number; error: string }
> {
  const existing = await getPersonalCalendarEvent(businessId, eventId);
  if (!existing) {
    return { ok: false, status: 404, error: "Event not found." };
  }

  const windowError = validateCalendarVisitWindow(
    input.startTime,
    input.endTime,
  );
  if (windowError) {
    return { ok: false, status: 400, error: windowError };
  }

  if (
    input.date !== existing.date &&
    (await isBusinessClosedOnDate(businessId, input.date))
  ) {
    return {
      ok: false,
      status: 400,
      error:
        "This business is closed on the selected date. Reactivate the day on the calendar to schedule work.",
    };
  }

  const ref = adminDb.collection(PERSONAL_EVENTS_COLLECTION).doc(eventId);
  await ref.update({
    title: input.title,
    notes: input.notes ?? null,
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const snap = await ref.get();
  return {
    ok: true,
    event: mapPersonalEventDoc(ref.id, snap.data() ?? {}),
  };
}

export async function deletePersonalCalendarEvent(
  businessId: string,
  eventId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const existing = await getPersonalCalendarEvent(businessId, eventId);
  if (!existing) {
    return { ok: false, status: 404, error: "Event not found." };
  }

  await adminDb.collection(PERSONAL_EVENTS_COLLECTION).doc(eventId).delete();
  return { ok: true };
}
