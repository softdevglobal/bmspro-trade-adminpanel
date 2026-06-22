"use client";

import {
  CalendarVisitTimeRangeFields,
  defaultCalendarVisitEnd,
  validateCalendarVisitWindow,
} from "@/components/calendar-visit-time-range";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import type { CalendarSlotSelection } from "@/lib/calendar/time-slots";
import type { PersonalCalendarEvent } from "@/lib/calendar/personal-events/types";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { formatSlotDate } from "@/lib/inspection/types";
import { useCallback, useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  initialSlot?: CalendarSlotSelection | null;
  editEvent?: PersonalCalendarEvent | null;
  onSaved?: () => void;
};

export function AddPersonalEventModal({
  open,
  onClose,
  initialSlot = null,
  editEvent = null,
  onSaved,
}: Props) {
  const { user } = useAuth();
  const profile = useBusinessProfile();
  const timeZone = profile?.timezone;
  const isEditing = Boolean(editEvent);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("09:00");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const reset = useCallback(() => {
    if (editEvent) {
      setTitle(editEvent.title);
      setNotes(editEvent.notes ?? "");
      setDate(editEvent.date);
      setStartTime(editEvent.startTime);
      setEndTime(editEvent.endTime);
    } else {
      setTitle("");
      setNotes("");
      setDate(initialSlot?.date ?? "");
      setStartTime(initialSlot?.startTime ?? "08:00");
      setEndTime(initialSlot?.endTime ?? "09:00");
    }
    setError(null);
    setSubmitting(false);
    setDeleting(false);
    setDeleteConfirmOpen(false);
  }, [editEvent, initialSlot]);

  const handleClose = useCallback(() => {
    if (deleteConfirmOpen) return;
    reset();
    onClose();
  }, [onClose, reset, deleteConfirmOpen]);

  useEffect(() => {
    if (!open) return;
    reset();
  }, [open, editEvent, initialSlot, reset]);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting && !deleting && !deleteConfirmOpen) {
        handleClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, submitting, deleting, deleteConfirmOpen, handleClose]);

  async function handleSubmit() {
    if (!user) return;

    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 2) {
      setError("Title must be at least 2 characters.");
      return;
    }
    if (!date) {
      setError("Choose a date for this event.");
      return;
    }

    const windowError = validateCalendarVisitWindow(startTime, endTime);
    if (windowError) {
      setError(windowError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        isEditing
          ? `/api/calendar/personal-events/${editEvent!.id}`
          : "/api/calendar/personal-events",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: trimmedTitle,
            notes: notes.trim() || null,
            date,
            startTime,
            endTime,
          }),
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save personal event.");
      }
      onSaved?.();
      handleClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save personal event.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!user || !editEvent) return;

    setDeleting(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch(
        `/api/calendar/personal-events/${editEvent.id}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not delete personal event.");
      }
      setDeleteConfirmOpen(false);
      onSaved?.();
      handleClose();
    } catch (deleteError) {
      setDeleteConfirmOpen(false);
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete personal event.",
      );
    } finally {
      setDeleting(false);
    }
  }

  if (!open) return null;

  const busy = submitting || deleting;

  return (
    <>
      <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close personal event"
        onClick={handleClose}
        className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-personal-event-title"
        className="relative flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-outline-variant bg-surface-container-lowest shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-outline-variant px-5 py-4">
          <div>
            <h2
              id="add-personal-event-title"
              className="font-display text-headline-sm font-bold text-on-surface"
            >
              {isEditing ? "Edit personal event" : "Personal event"}
            </h2>
            {date && !isEditing ? (
              <p className="mt-1 font-body text-[13px] text-on-surface-variant">
                {formatSlotDate(date, timeZone)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-container"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
          <label className="block">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Title
            </span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Site measure, supplier visit"
              disabled={busy}
              className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
            />
          </label>

          {isEditing ? (
            <label className="block">
              <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Date
              </span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={busy}
                className="mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
              />
            </label>
          ) : null}

          <CalendarVisitTimeRangeFields
            startTime={startTime}
            endTime={endTime}
            disabled={busy}
            onStartTimeChange={(nextStart) => {
              setStartTime(nextStart);
              setEndTime(defaultCalendarVisitEnd(nextStart));
            }}
            onEndTimeChange={setEndTime}
          />

          <label className="block">
            <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Notes
            </span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Optional details for your team"
              disabled={busy}
              className="mt-1 w-full resize-y rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 disabled:opacity-60"
            />
          </label>

          {error ? (
            <p className="rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-outline-variant px-5 py-4">
          {isEditing ? (
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2.5 font-body text-[14px] font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">
                {deleting ? "progress_activity" : "delete"}
              </span>
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-xl px-4 py-2.5 font-body text-[14px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2.5 font-body text-[14px] font-semibold text-on-primary transition-opacity disabled:opacity-60"
            >
              {submitting ? "Saving…" : isEditing ? "Save changes" : "Save event"}
            </button>
          </div>
        </div>
      </div>
      </div>

      <DeleteConfirmModal
        stacked
        open={deleteConfirmOpen}
        title="Delete personal event?"
        description={
          editEvent
            ? `Are you sure you want to delete "${editEvent.title}"? This will remove it from your calendar and cannot be undone.`
            : "This will remove the event from your calendar and cannot be undone."
        }
        confirmLabel="Yes, delete event"
        cancelLabel="Keep event"
        isLoading={deleting}
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
