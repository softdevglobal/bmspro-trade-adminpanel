"use client";

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { auth } from "@/lib/firebase/client";
import {
  BROADCAST_AUDIENCE_LABELS,
  type BroadcastAudience,
  type BroadcastRecord,
} from "@/lib/broadcasts/types";
import { useCallback, useEffect, useMemo, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<FetchResult<T>> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: (T & { ok?: boolean; error?: string }) | null = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text) as T & { ok?: boolean; error?: string };
    } catch {
      return { ok: false, error: "Invalid response from server." };
    }
  }
  if (!response.ok || !body || body.ok === false) {
    return { ok: false, error: body?.error ?? "Request failed." };
  }
  return { ok: true, data: body };
}

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function platformLabel(record: BroadcastRecord): string {
  const parts: string[] = [];
  if (record.platforms.admin) parts.push("Admin panel");
  if (record.platforms.mobile) parts.push("Mobile app");
  return parts.length ? parts.join(" + ") : "—";
}

export function CustomMessagesBoard() {
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [targetAdmin, setTargetAdmin] = useState(true);
  const [targetMobile, setTargetMobile] = useState(true);
  const [audience, setAudience] = useState<BroadcastAudience>("owners");
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BroadcastRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    const result = await authFetch<{ broadcasts: BroadcastRecord[] }>(
      "/api/admin/broadcasts",
    );
    if (result.ok) {
      setBroadcasts(result.data.broadcasts ?? []);
      setListError(null);
    } else {
      setListError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canSubmit = useMemo(
    () =>
      title.trim().length > 0 &&
      body.trim().length > 0 &&
      (targetAdmin || targetMobile) &&
      !sending,
    [title, body, targetAdmin, targetMobile, sending],
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSuccessMessage(null);

    if (!title.trim() || !body.trim()) {
      setFormError("Add a title and a message.");
      return;
    }
    if (!targetAdmin && !targetMobile) {
      setFormError("Choose at least one platform.");
      return;
    }

    setSending(true);
    const result = await authFetch<{ mobilePushCount: number }>(
      "/api/admin/broadcasts",
      {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          platforms: { admin: targetAdmin, mobile: targetMobile },
          audience,
        }),
      },
    );
    setSending(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    const pushCount = result.data.mobilePushCount ?? 0;
    setSuccessMessage(
      targetMobile
        ? `Message sent. Push notification delivered to ${pushCount} device${
            pushCount === 1 ? "" : "s"
          }.`
        : "Message sent.",
    );
    setTitle("");
    setBody("");
    void load();
  }

  async function toggleActive(record: BroadcastRecord) {
    setBusyId(record.id);
    const result = await authFetch(`/api/admin/broadcasts/${record.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !record.active }),
    });
    setBusyId(null);
    if (result.ok) {
      setBroadcasts((current) =>
        current.map((item) =>
          item.id === record.id ? { ...item, active: !item.active } : item,
        ),
      );
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    const result = await authFetch(`/api/admin/broadcasts/${pendingDelete.id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (result.ok) {
      setBroadcasts((current) =>
        current.filter((item) => item.id !== pendingDelete.id),
      );
    }
    setPendingDelete(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Compose */}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">edit_note</span>
          <h3 className="font-display text-[17px] font-bold text-on-surface">
            New message
          </h3>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">
              Title
            </label>
            <input
              type="text"
              value={title}
              maxLength={MAX_TITLE_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Scheduled maintenance tonight"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1 block font-body text-[13px] font-semibold text-on-surface">
              Message
            </label>
            <textarea
              value={body}
              maxLength={MAX_BODY_LENGTH}
              onChange={(event) => setBody(event.target.value)}
              rows={4}
              placeholder="Write the announcement recipients will see as a notification."
              className={`${INPUT_CLASS} resize-y`}
            />
            <p className="mt-1 text-right font-body text-[11px] text-on-surface-variant">
              {body.length}/{MAX_BODY_LENGTH}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="rounded-xl border border-outline-variant p-3">
              <legend className="px-1 font-body text-[12px] font-semibold text-on-surface-variant">
                Show on
              </legend>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
                <input
                  type="checkbox"
                  checked={targetAdmin}
                  onChange={(event) => setTargetAdmin(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Admin panel (web)
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
                <input
                  type="checkbox"
                  checked={targetMobile}
                  onChange={(event) => setTargetMobile(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Mobile app (push + in-app)
              </label>
            </fieldset>

            <fieldset className="rounded-xl border border-outline-variant p-3">
              <legend className="px-1 font-body text-[12px] font-semibold text-on-surface-variant">
                Send to
              </legend>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === "owners"}
                  onChange={() => setAudience("owners")}
                  className="h-4 w-4 accent-primary"
                />
                {BROADCAST_AUDIENCE_LABELS.owners}
              </label>
              <label className="flex cursor-pointer items-center gap-2 py-1.5 font-body text-[14px] text-on-surface">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === "all"}
                  onChange={() => setAudience("all")}
                  className="h-4 w-4 accent-primary"
                />
                {BROADCAST_AUDIENCE_LABELS.all}
              </label>
            </fieldset>
          </div>

          {formError ? (
            <p className="rounded-lg bg-error-container/60 px-3 py-2 font-body text-[13px] text-error">
              {formError}
            </p>
          ) : null}
          {successMessage ? (
            <p className="rounded-lg bg-primary/10 px-3 py-2 font-body text-[13px] text-primary">
              {successMessage}
            </p>
          ) : null}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`material-symbols-outlined text-[18px] ${
                  sending ? "animate-spin" : ""
                }`}
              >
                {sending ? "progress_activity" : "send"}
              </span>
              {sending ? "Sending..." : "Send message"}
            </button>
          </div>
        </div>
      </form>

      {/* History */}
      <div className="rounded-2xl border border-outline-variant bg-surface p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">history</span>
            <h3 className="font-display text-[17px] font-bold text-on-surface">
              Sent messages
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <span className="material-symbols-outlined animate-spin text-[22px] text-primary">
              progress_activity
            </span>
          </div>
        ) : listError ? (
          <p className="py-6 text-center font-body text-[13px] text-error">
            {listError}
          </p>
        ) : broadcasts.length === 0 ? (
          <p className="py-10 text-center font-body text-[13px] text-on-surface-variant">
            No messages sent yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {broadcasts.map((record) => (
              <li
                key={record.id}
                className={`rounded-xl border border-outline-variant/70 p-4 ${
                  record.active ? "bg-surface-container-lowest" : "bg-surface-container-low opacity-70"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-body text-[14px] font-bold text-on-surface">
                        {record.title}
                      </p>
                      {!record.active ? (
                        <span className="rounded-full bg-on-surface-variant/15 px-2 py-0.5 font-body text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
                          Recalled
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap font-body text-[13px] leading-snug text-on-surface-variant">
                      {record.body}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-[11px] text-on-surface-variant">
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">
                          devices
                        </span>
                        {platformLabel(record)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">
                          group
                        </span>
                        {BROADCAST_AUDIENCE_LABELS[record.audience]}
                      </span>
                      {record.platforms.mobile && record.mobilePushCount != null ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px]">
                            notifications_active
                          </span>
                          {record.mobilePushCount} push
                        </span>
                      ) : null}
                      <span>{relativeTime(record.createdAt)}</span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void toggleActive(record)}
                      disabled={busyId === record.id}
                      title={record.active ? "Recall (hide from recipients)" : "Re-activate"}
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high disabled:opacity-60"
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] ${
                          busyId === record.id ? "animate-spin" : ""
                        }`}
                      >
                        {busyId === record.id
                          ? "progress_activity"
                          : record.active
                            ? "visibility_off"
                            : "visibility"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(record)}
                      title="Delete permanently"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        delete
                      </span>
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DeleteConfirmModal
        open={pendingDelete != null}
        title="Delete message?"
        description="This permanently removes the message. Recipients who already saw it keep their copy, but it will no longer be delivered to anyone new."
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        isLoading={deleting}
      />
    </div>
  );
}
