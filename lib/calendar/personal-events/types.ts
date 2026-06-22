import { isClockTime } from "@/lib/inspection/types";

export const PERSONAL_EVENTS_COLLECTION = "calendar_personal_events";

export type PersonalCalendarEvent = {
  id: string;
  businessId: string;
  title: string;
  notes: string | null;
  date: string;
  startTime: string;
  endTime: string;
  createdByUid: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CreatePersonalEventInput = {
  title: string;
  notes?: string | null;
  date: string;
  startTime: string;
  endTime: string;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseCreatePersonalEventInput(
  raw: unknown,
): { ok: true; value: CreatePersonalEventInput } | { ok: false; error: string } {
  return parsePersonalEventInput(raw);
}

export function parseUpdatePersonalEventInput(
  raw: unknown,
): { ok: true; value: CreatePersonalEventInput } | { ok: false; error: string } {
  return parsePersonalEventInput(raw);
}

function parsePersonalEventInput(
  raw: unknown,
): { ok: true; value: CreatePersonalEventInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Invalid request body." };
  }

  const input = raw as Record<string, unknown>;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length < 2) {
    return { ok: false, error: "Title must be at least 2 characters." };
  }

  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!isIsoDate(date)) {
    return { ok: false, error: "Choose a valid date." };
  }

  const startTime =
    typeof input.startTime === "string" ? input.startTime.trim() : "";
  const endTime = typeof input.endTime === "string" ? input.endTime.trim() : "";
  if (!isClockTime(startTime) || !isClockTime(endTime)) {
    return { ok: false, error: "Choose a valid start and end time." };
  }

  const notes =
    typeof input.notes === "string" && input.notes.trim()
      ? input.notes.trim()
      : null;

  return {
    ok: true,
    value: { title, notes, date, startTime, endTime },
  };
}
