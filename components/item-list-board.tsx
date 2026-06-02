"use client";

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { auth } from "@/lib/firebase/client";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

type CatalogItem = {
  id: string;
  name: string;
  code: string | null;
  priceAud: number;
  imageUrl: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

const NUMBER_INPUT_CLASS = `${INPUT_CLASS} [appearance:textfield] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`;

const ITEM_EDITOR_STEPS = 2;

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

async function uploadItemImageFile(
  file: File,
): Promise<{ ok: true; imageUrl: string } | { ok: false; error: string }> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };

  const token = await user.getIdToken();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/item-image", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await readJson<{
    ok?: boolean;
    error?: string;
    imageUrl?: string;
  }>(response);

  if (!response.ok || !data.ok || !data.imageUrl) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : "Could not upload image.",
    };
  }

  return { ok: true, imageUrl: data.imageUrl };
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
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        (item.code?.toLowerCase().includes(query) ?? false),
    );
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest p-5"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-container text-on-primary">
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="material-symbols-outlined text-[26px]">
                    sell
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                {item.code ? (
                  <p className="font-numeric truncate font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                    {item.code}
                  </p>
                ) : null}
                <p className="truncate font-display text-[17px] font-semibold text-on-surface">
                  {item.name}
                </p>
                <p className="font-numeric mt-1 text-[15px] font-semibold text-primary">
                  {formatPrice(item.priceAud)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  aria-label={`Edit ${item.name}`}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[22px]">
                    edit
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(item)}
                  aria-label={`Delete ${item.name}`}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-error-container hover:text-error"
                >
                  <span className="material-symbols-outlined text-[22px]">
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
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [price, setPrice] = useState(
    item ? item.priceAud.toString() : "",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const progressPercent = Math.round((currentStep / ITEM_EDITOR_STEPS) * 100);

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

  function validateForm(): boolean {
    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price.trim());
    if (trimmedName.length < 1) {
      setLocalError("Item name is required.");
      return false;
    }
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setLocalError("Enter a valid price.");
      return false;
    }
    setLocalError(null);
    return true;
  }

  function handleContinue() {
    if (!validateForm()) return;
    setCurrentStep(2);
  }

  function handleBack() {
    setLocalError(null);
    setCurrentStep(1);
  }

  async function handleSave() {
    if (isSaving || !validateForm()) return;

    const trimmedName = name.trim();
    const parsedPrice = Number.parseFloat(price.trim());

    setIsSaving(true);
    setLocalError(null);
    onError(null);

    const path = isEdit ? `/api/items/${item.id}` : "/api/items";
    const method = isEdit ? "PATCH" : "POST";
    const result = await authFetch<{ ok: true }>(path, {
      method,
      body: JSON.stringify({
        name: trimmedName,
        priceAud: parsedPrice,
        code: code.trim() || null,
        imageUrl,
      }),
    });

    setIsSaving(false);
    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    onSaved();
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    setLocalError(null);
    const result = await uploadItemImageFile(file);
    setIsUploading(false);

    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    setImageUrl(result.imageUrl);
  }

  const parsedPreviewPrice = Number.parseFloat(price.trim());
  const previewPrice =
    Number.isFinite(parsedPreviewPrice) && parsedPreviewPrice >= 0
      ? parsedPreviewPrice
      : 0;

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
        aria-labelledby="item-editor-title"
        className="relative z-10 grid h-[min(92dvh,calc(100dvh-2rem))] max-h-[min(92dvh,calc(100dvh-2rem))] w-full max-w-md grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">
              Step {currentStep} of {ITEM_EDITOR_STEPS}
            </p>
            <h2
              id="item-editor-title"
              className="font-display text-headline-sm font-semibold text-on-surface"
            >
              {isEdit ? "Edit item" : "Add item"}
            </h2>
            <p className="mt-1 font-body text-[13px] text-on-surface-variant">
              {currentStep === 1
                ? "Add the photo, name and price for your catalog item."
                : "Review how this item will appear in your list."}
            </p>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="min-h-0 overflow-y-auto px-5 py-5">
          {localError ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">
                error
              </span>
              <span>{localError}</span>
            </div>
          ) : null}

          {currentStep === 1 ? (
            <div className="flex flex-col gap-4">
              <ItemEditorHero
                eyebrow="Step 1 · Item details"
                title="Photo, name and price"
                description="These details appear in your item catalog and quotations."
                icon="inventory_2"
              />

              <label className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Photo
                </span>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative mx-auto h-24 w-24 shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low sm:mx-0">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt="Item preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[28px]">
                          add_a_photo
                        </span>
                        <span className="font-body text-[10px] font-semibold uppercase tracking-wide">
                          No photo
                        </span>
                      </div>
                    )}
                    {isUploading ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-on-background/40 backdrop-blur-[2px]">
                        <span className="material-symbols-outlined animate-spin text-[24px] text-primary">
                          progress_activity
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high">
                      <span className="material-symbols-outlined text-[18px]">
                        upload
                      </span>
                      {isUploading ? "Uploading…" : "Upload photo"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        disabled={isUploading || isSaving}
                        onChange={(event) => void handlePhotoChange(event)}
                      />
                    </label>
                    {imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setImageUrl(null)}
                        disabled={isUploading || isSaving}
                        className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-error disabled:opacity-60"
                      >
                        Remove photo
                      </button>
                    ) : null}
                    <p className="font-body text-[11px] text-on-surface-variant">
                      JPEG, PNG, WebP or GIF · max 5 MB
                    </p>
                  </div>
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Item code
                </span>
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="e.g. TAP-001"
                  className={INPUT_CLASS}
                  autoFocus
                />
              </label>

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
                  className={NUMBER_INPUT_CLASS}
                />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ItemEditorHero
                eyebrow="Step 2 · Review"
                title="Preview before saving"
                description="Check the photo, name and price, then save this item."
                icon="fact_check"
              />

              <ItemPreviewPanel
                name={name.trim() || "Untitled item"}
                code={code.trim() || null}
                priceAud={previewPrice}
                imageUrl={imageUrl}
              />
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant px-5 py-4 shadow-[0_-8px_24px_rgba(0,42,150,0.08)]">
          <button
            type="button"
            onClick={currentStep === 1 ? onClose : handleBack}
            className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low"
          >
            {currentStep === 1 ? "Cancel" : "Back"}
          </button>

          {currentStep < ITEM_EDITOR_STEPS ? (
            <button
              type="button"
              onClick={handleContinue}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-body text-[13px] font-semibold text-on-primary disabled:opacity-60"
            >
              Continue
              <span className="material-symbols-outlined text-[18px]">
                arrow_forward
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isUploading}
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
          )}
        </footer>
      </div>
    </div>
  );
}

function ItemEditorHero({
  eyebrow,
  title,
  description,
  icon,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#00174b] via-primary-container to-primary px-4 py-4 text-on-primary">
      <div
        className="pointer-events-none absolute -right-4 top-0 opacity-[0.1]"
        aria-hidden
      >
        <span className="material-symbols-outlined text-[5rem]">{icon}</span>
      </div>
      <p className="relative font-body text-[10px] font-bold uppercase tracking-[0.16em] text-white/80">
        {eyebrow}
      </p>
      <h3 className="relative mt-1 font-display text-[1.15rem] font-semibold text-white">
        {title}
      </h3>
      <p className="relative mt-1.5 font-body text-[12px] text-white/85">
        {description}
      </p>
    </div>
  );
}

function ItemPreviewPanel({
  name,
  code,
  priceAud,
  imageUrl,
}: {
  name: string;
  code: string | null;
  priceAud: number;
  imageUrl: string | null;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-outline-variant bg-surface-container-lowest shadow-sm">
      <div className="border-b border-outline-variant/60 bg-surface-container-low px-4 py-3">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Catalog preview
        </p>
      </div>

      <div className="flex items-center gap-4 p-5">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-container text-on-primary">
          {imageUrl ? (
            <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-[26px]">sell</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[17px] font-semibold text-on-surface">
            {name}
          </p>
          <p className="font-numeric mt-1 text-[15px] font-semibold text-primary">
            {formatPrice(priceAud)}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 border-t border-outline-variant/60 p-4 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Code
          </p>
          <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">
            {code ?? "—"}
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Name
          </p>
          <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">
            {name}
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Price
          </p>
          <p className="font-numeric mt-1 text-[13px] font-semibold text-on-surface">
            {formatPrice(priceAud)}
          </p>
        </div>
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Photo
          </p>
          <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">
            {imageUrl ? "Photo added" : "No photo"}
          </p>
        </div>
      </div>
    </section>
  );
}
