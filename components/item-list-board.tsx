"use client";

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { auth } from "@/lib/firebase/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type CatalogItem = {
  id: string;
  name: string;
  priceAud: number;
  createdAt: number | null;
  updatedAt: number | null;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

async function readJson<T extends { ok?: boolean; error?: string }>(
  response: Response,
): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    return { ok: false, error: "Empty response from server." } as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { ok: false, error: "Invalid response from server." } as T;
  }
}

async function authFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const user = auth.currentUser;
    if (!user) return { ok: false, error: "Please sign in again." };

    const token = await user.getIdToken();
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers ?? {}),
      },
    });

    const data = await readJson<T & { ok?: boolean; error?: string }>(response);
    if (!response.ok || data.ok === false) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "Request failed.",
      };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Network error. Please try again." };
  }
}

function formatPrice(value: number): string {
  return `Aus $${value.toFixed(2)}`;
}

export function ItemListBoard() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CatalogItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const result = await authFetch<{ items: CatalogItem[] }>("/api/items");
    if (!result.ok) {
      setErrorMessage(result.error);
      setItems([]);
    } else {
      setItems(result.data.items ?? []);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => item.name.toLowerCase().includes(query));
  }, [items, search]);

  function openCreate() {
    setEditTarget(null);
    setEditorOpen(true);
  }

  function openEdit(item: CatalogItem) {
    setEditTarget(item);
    setEditorOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await authFetch<{ ok: true }>(
      `/api/items/${deleteTarget.id}`,
      { method: "DELETE" },
    );
    setIsDeleting(false);
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }
    setDeleteTarget(null);
    void load();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <label className="relative flex h-10 w-full items-center sm:max-w-sm">
          <span className="material-symbols-outlined pointer-events-none absolute left-3 text-[18px] text-outline">
            search
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search items..."
            className="h-full w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-10 pr-3 font-body text-[13px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="flex h-10 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[18px]">
              refresh
            </span>
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-body text-[13px] font-semibold text-on-primary shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add item
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
          <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
            error
          </span>
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest py-16 font-body text-body-md text-on-surface-variant">
          <span className="material-symbols-outlined mr-2 animate-spin text-[20px]">
            progress_activity
          </span>
          Loading items...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-outline-variant bg-surface-container-lowest px-6 py-14 text-center">
          <span className="material-symbols-outlined text-[36px] text-outline-variant">
            inventory_2
          </span>
          <p className="mt-3 font-body text-body-md text-on-surface-variant">
            {items.length === 0
              ? "No items yet. Items are added automatically when you send a quotation, or add one manually."
              : "No items match your search."}
          </p>
          {items.length === 0 ? (
            <button
              type="button"
              onClick={openCreate}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 font-body text-[13px] font-semibold text-on-primary"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              Add item
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-4"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-container text-on-primary">
                <span className="material-symbols-outlined text-[22px]">
                  sell
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold text-on-surface">
                  {item.name}
                </p>
                <p className="mt-0.5 font-body text-[13px] font-semibold text-primary">
                  {formatPrice(item.priceAud)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  aria-label={`Edit ${item.name}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    edit
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(item)}
                  aria-label={`Delete ${item.name}`}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                >
                  <span className="material-symbols-outlined text-[20px]">
                    delete
                  </span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editorOpen ? (
        <ItemEditorModal
          item={editTarget}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            void load();
          }}
          onError={setErrorMessage}
        />
      ) : null}

      <DeleteConfirmModal
        open={deleteTarget !== null}
        title="Delete item?"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.name}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Yes, delete"
        cancelLabel="No, cancel"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

function ItemEditorModal({
  item,
  onClose,
  onSaved,
  onError,
}: {
  item: CatalogItem | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
}) {
  const isEdit = item !== null;
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(
    item ? item.priceAud.toString() : "",
  );
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  async function handleSave() {
    if (isSaving) return;
    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price.trim());
    if (trimmedName.length < 1) {
      setLocalError("Item name is required.");
      return;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setLocalError("Enter a valid price.");
      return;
    }

    setIsSaving(true);
    setLocalError(null);
    onError(null);

    const path = isEdit ? `/api/items/${item.id}` : "/api/items";
    const method = isEdit ? "PATCH" : "POST";
    const result = await authFetch<{ ok: true }>(path, {
      method,
      body: JSON.stringify({ name: trimmedName, priceAud: parsedPrice }),
    });

    setIsSaving(false);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-outline-variant px-5 py-4">
          <h2 className="font-display text-headline-sm font-semibold text-on-surface">
            {isEdit ? "Edit item" : "Add item"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="flex flex-col gap-4 px-5 py-5">
          {localError && (
            <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                error
              </span>
              <span>{localError}</span>
            </div>
          )}

          <label className="flex flex-col gap-2">
            <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
              Name <span className="text-error">*</span>
            </span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Tap replacement"
              className={INPUT_CLASS}
              autoFocus
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
              Price (AUD) <span className="text-error">*</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0.00"
              className={INPUT_CLASS}
            />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-3 border-t border-outline-variant px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
          >
            {isSaving ? (
              <>
                <span className="material-symbols-outlined animate-spin text-[18px]">
                  progress_activity
                </span>
                Saving...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[18px]">
                  save
                </span>
                {isEdit ? "Save changes" : "Add item"}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
