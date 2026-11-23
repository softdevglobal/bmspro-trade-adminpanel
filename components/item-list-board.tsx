"use client";

import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import { auth } from "@/lib/firebase/client";
import { fetchAdminItemDocumentBytes } from "@/lib/pdf/fetch-admin-document-pdf";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  formatAud, ITEM_FORM_SECTIONS, ITEM_LIMITS, itemFormVoice, itemNameKey, itemsPageVoice, type ItemFormArgs,
} from "@/lib/ai/owner-call/owner-item";
import { matchByName, type VoiceResult } from "@/lib/ai/owner-call/owner-team";

import {
  duplicateItemCodeError,
  nameQualityWarning,
} from "@/lib/validation/data-quality";

type CatalogItem = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  priceAud: number;
  imageUrl: string | null;
  documentUrl: string | null;
  documentName: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

/**
 * The item document currently open in the PDF popup.
 *
 * Bytes never come from the stored URL directly: Firebase Storage sends no CORS
 * headers for this origin. A saved item is proxied through the API by id; a
 * document just picked in the editor is read straight from the local file,
 * which needs no network at all.
 */
type ItemDocumentPreview = {
  source: { kind: "item"; itemId: string } | { kind: "file"; file: File };
  /** Stored URL, used only by the viewer's open-in-new-tab fallback. */
  url: string | null;
  name: string | null;
  itemName: string;
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

async function uploadItemDocumentFile(
  file: File,
): Promise<
  | { ok: true; documentUrl: string; documentName: string }
  | { ok: false; error: string }
> {
  const user = auth.currentUser;
  if (!user) return { ok: false, error: "Please sign in again." };

  const token = await user.getIdToken();
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/uploads/item-document", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await readJson<{
    ok?: boolean;
    error?: string;
    documentUrl?: string;
    documentName?: string;
  }>(response);

  if (!response.ok || !data.ok || !data.documentUrl) {
    return {
      ok: false,
      error:
        typeof data.error === "string" ? data.error : "Could not upload document.",
    };
  }

  return {
    ok: true,
    documentUrl: data.documentUrl,
    documentName: data.documentName?.trim() || file.name || "Document.pdf",
  };
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
  // Item documents open in the same in-app PDF popup as quotations and
  // invoices, so viewing a spec sheet never navigates away from the catalog.
  const [documentPreview, setDocumentPreview] =
    useState<ItemDocumentPreview | null>(null);

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
        (item.code?.toLowerCase().includes(query) ?? false) ||
        (item.description?.toLowerCase().includes(query) ?? false),
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

  /** Returns null when deleted, otherwise the reason (also shown on the page). */
  async function confirmDelete(): Promise<string | null> {
    if (!deleteTarget) return "Nothing is selected to delete.";
    if (isDeleting) return "Already deleting.";
    setIsDeleting(true);
    setErrorMessage(null);
    const result = await authFetch<{ ok: true }>(
      `/api/items/${deleteTarget.id}`,
      { method: "DELETE" },
    );
    setIsDeleting(false);
    if (!result.ok) {
      setErrorMessage(result.error);
      return result.error;
    }
    setDeleteTarget(null);
    void load();
    return null;
  }

  // Sophie (voice): search, open Add / Edit, and delete through the same dialog as the owner.
  // See lib/ai/owner-call/owner-item.ts. Registered once the list has loaded.
  const voice = useRef({ items, deleteTarget, confirmDelete });
  useEffect(() => {
    voice.current = { items, deleteTarget, confirmDelete };
  });
  useEffect(() => {
    if (isLoading) return;
    const find = (itemName: string) => matchByName(voice.current.items, (item) => item.name, itemName, "item");
    return itemsPageVoice.register({
      setSearch(next) {
        setSearch(next);
      },
      openAdd() {
        setDeleteTarget(null);
        setSearch("");
        setEditTarget(null);
        setEditorOpen(true);
        return { status: "OPENED", message: "The Add item popup is open. Ask for the item name and price, then use item_form_step." };
      },
      openEdit(itemName) {
        const found = find(itemName);
        if (!found.ok) return found.result;
        const item = found.item;
        setDeleteTarget(null);
        setEditTarget(item);
        setEditorOpen(true);
        return {
          status: "OPENED",
          message: `Edit item is open for "${item.name}": ${item.code ? `code ${item.code}, ` : ""}price ${formatAud(item.priceAud)}` +
            `${item.description ? `, description: ${item.description}` : ""}. Ask what to change, then use item_form_step.`,
        };
      },
      prepareDelete(itemName) {
        const found = find(itemName);
        if (!found.ok) return found.result;
        setEditorOpen(false);
        setDeleteTarget(found.item);
        return {
          status: "CONFIRM",
          message: `The delete dialog for "${found.item.name}" (${formatAud(found.item.priceAud)}) is on screen. Nothing is deleted yet. ` +
            `Ask: Should I delete ${found.item.name}? This cannot be undone.`,
        };
      },
      async confirmDelete() {
        const target = voice.current.deleteTarget;
        if (!target) return { status: "NOTHING_TO_CONFIRM", message: "The delete dialog is not open." };
        const failure = await voice.current.confirmDelete();
        return failure ? { status: "FAILED", message: `Not deleted: ${failure}` } : { status: "DONE", message: `"${target.name}" is deleted.` };
      },
      cancel() {
        setDeleteTarget(null);
        return { status: "CANCELLED", message: "Nothing was deleted." };
      },
    });
  }, [isLoading]);

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
                  // eslint-disable-next-line @next/next/no-img-element
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
                {item.documentUrl ? (
                  <p className="mt-1 flex items-center gap-1 truncate font-body text-[11px] text-on-surface-variant">
                    <span className="material-symbols-outlined text-[14px]">
                      description
                    </span>
                    <span className="truncate">
                      {item.documentName ?? "Document"}
                    </span>
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {item.documentUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDocumentPreview({
                        source: { kind: "item", itemId: item.id },
                        url: item.documentUrl,
                        name: item.documentName,
                        itemName: item.name,
                      })
                    }
                    aria-label={`View document for ${item.name}`}
                    className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
                  >
                    <span className="material-symbols-outlined text-[22px]">
                      picture_as_pdf
                    </span>
                  </button>
                ) : null}
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
          // A fresh popup per item, so switching items (e.g. by voice) never keeps the old values.
          key={editTarget?.id ?? "new"}
          item={editTarget}
          existingItems={items}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            void load();
          }}
          onError={setErrorMessage}
          onPreviewDocument={setDocumentPreview}
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

      {documentPreview ? (
        <QuotationPdfViewerModal
          open
          onClose={() => setDocumentPreview(null)}
          pdfUrl={documentPreview.url ?? ""}
          title={`${documentPreview.itemName} · ${documentPreview.name ?? "Document"}`}
          downloadFilename={documentPreview.name ?? "item-document.pdf"}
          loadPdfBytes={async () => {
            const { source } = documentPreview;
            if (source.kind === "file") {
              return new Uint8Array(await source.file.arrayBuffer());
            }
            const user = auth.currentUser;
            if (!user) throw new Error("Please sign in again.");
            return fetchAdminItemDocumentBytes(user, source.itemId);
          }}
        />
      ) : null}
    </div>
  );
}

function ItemEditorModal({
  item,
  existingItems,
  onClose,
  onSaved,
  onError,
  onPreviewDocument,
}: {
  item: CatalogItem | null;
  existingItems: CatalogItem[];
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string | null) => void;
  onPreviewDocument: (preview: ItemDocumentPreview) => void;
}) {
  const isEdit = item !== null;
  const [currentStep, setCurrentStep] = useState(1);
  const [name, setName] = useState(item?.name ?? "");
  const [code, setCode] = useState(item?.code ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(
    item ? item.priceAud.toString() : "",
  );
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null);
  const [documentUrl, setDocumentUrl] = useState<string | null>(
    item?.documentUrl ?? null,
  );
  const [documentName, setDocumentName] = useState<string | null>(
    item?.documentName ?? null,
  );
  // Kept so a document picked in this session can be previewed from the local
  // file — it has no catalog id to proxy by until the item is saved.
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingDocument, setIsUploadingDocument] = useState(false);
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

  /** What is wrong with these values, or null. Shared by the buttons and Sophie (voice). */
  function formError(values: { name: string; price: string; code: string }): string | null {
    const parsedPrice = Number.parseFloat(values.price.trim());
    if (values.name.trim().length < 1) return "Item name is required.";
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) return "Enter a valid price.";
    return duplicateItemCodeError(values.code, existingItems, item?.id ?? null);
  }

  function validateForm(): boolean {
    const problem = formError({ name, price, code });
    setLocalError(problem);
    return problem === null;
  }

  // Advisory only — a sloppy-looking name never blocks saving.
  const nameWarning = nameQualityWarning(name);

  function handleContinue() {
    if (!validateForm()) return;
    setCurrentStep(2);
  }

  function handleBack() {
    setLocalError(null);
    setCurrentStep(1);
  }

  /** Saves. Returns null when saved, otherwise the reason (also shown in the popup). */
  async function handleSave(): Promise<string | null> {
    if (isSaving) return "Already saving.";
    if (!validateForm()) return formError({ name, price, code }) ?? "Check the item details.";

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
        description: description.trim() || null,
        imageUrl,
        documentUrl,
        documentName,
      }),
    });

    setIsSaving(false);
    if (!result.ok) {
      setLocalError(result.error);
      return result.error;
    }
    onSaved();
    return null;
  }

  // ---- Sophie (voice): fill, show, scroll, continue, back, save. See lib/ai/owner-call/owner-item.ts ----
  const bodyRef = useRef<HTMLDivElement>(null);
  const [voiceScroll, setVoiceScroll] = useState<{ to: string; at: number } | null>(null);
  const voice = useRef({ name, code, description, price, currentStep, imageUrl, documentName, handleSave, formError, onClose });
  useEffect(() => {
    voice.current = { name, code, description, price, currentStep, imageUrl, documentName, handleSave, formError, onClose };
  });
  // Each step starts at its top; an error scrolls up so it is seen.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [currentStep]);
  useEffect(() => { if (localError) bodyRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }, [localError]);
  // Bring what Sophie is working on into view and outline it briefly.
  useEffect(() => {
    const body = bodyRef.current;
    if (!voiceScroll || !body) return;
    const target = body.querySelector(`[data-voice-section="${voiceScroll.to}"]`);
    if (!(target instanceof HTMLElement)) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    const outline = ["ring-2", "ring-primary", "ring-offset-2", "rounded-lg"];
    target.classList.add(...outline);
    const timer = window.setTimeout(() => target.classList.remove(...outline), 2_000);
    return () => { window.clearTimeout(timer); target.classList.remove(...outline); };
  }, [voiceScroll]);
  useEffect(() => {
    // The values as the popup will show them once React renders; picks up the owner's own typing between calls.
    let live = voice.current;
    let seen = voice.current;
    const sync = () => { if (voice.current !== seen) live = seen = voice.current; };
    const sameName = (value: string) => !item
      ? existingItems.find((existing) => itemNameKey(existing.name) === itemNameKey(value)) ?? null
      : null;
    const goToStep = (step: number) => { if (live.currentStep !== step) { live = { ...live, currentStep: step }; setCurrentStep(step); } };
    const readBack = () => {
      const priceValue = Number.parseFloat(live.price.trim());
      const existing = sameName(live.name);
      return `name "${live.name.trim()}", ${live.code.trim() ? `code ${live.code.trim()}` : "no code"}, ` +
        `${live.description.trim() ? `description: ${live.description.trim()}` : "no description"}, price ${formatAud(priceValue)}, ` +
        `${live.imageUrl ? "with a photo" : "no photo"}, ${live.documentName ? `document ${live.documentName}` : "no document"}.` +
        (existing ? ` An item named "${existing.name}" already exists at ${formatAud(existing.priceAud)}: saving UPDATES that item, it does not add a new one.` : "");
    };

    return itemFormVoice.register({
      async step(args: ItemFormArgs): Promise<VoiceResult> {
        sync();
        const body = bodyRef.current;
        if (args.action === "cancel") {
          voice.current.onClose();
          return { status: "CANCELLED", message: "The popup is closed. Nothing was saved." };
        }
        if (args.action === "scroll_down" || args.action === "scroll_up") {
          if (!body) return { status: "NOT_OPEN", message: "The popup is not showing." };
          const down = args.action === "scroll_down";
          const atEdge = down ? body.scrollTop + body.clientHeight >= body.scrollHeight - 4 : body.scrollTop <= 4;
          if (atEdge) return { status: "OK", message: down ? "Already at the bottom." : "Already at the top." };
          body.scrollBy({ top: (down ? 1 : -1) * Math.round(body.clientHeight * 0.8), behavior: "smooth" });
          return { status: "OK", message: down ? "Scrolled down." : "Scrolled up." };
        }
        if (args.action === "show") {
          if (!args.section || !(ITEM_FORM_SECTIONS as readonly string[]).includes(args.section)) {
            return { status: "REJECTED", message: `section must be one of: ${ITEM_FORM_SECTIONS.join(", ")}.` };
          }
          goToStep(1);
          setVoiceScroll({ to: args.section, at: Date.now() });
          return { status: "OK", message: `The ${args.section} field is on screen.` };
        }
        if (args.action === "fill") {
          let section = "";
          const next = { ...live };
          if (args.name !== undefined) {
            if (!args.name || args.name.length > ITEM_LIMITS.nameMax) return { status: "INVALID", message: `Use a name of 1-${ITEM_LIMITS.nameMax} characters.` };
            next.name = args.name; section ||= "name";
          }
          if (args.code !== undefined) {
            if (args.code.length > ITEM_LIMITS.codeMax) return { status: "INVALID", message: `Use a code of up to ${ITEM_LIMITS.codeMax} characters.` };
            next.code = args.code; section ||= "code";
          }
          if (args.description !== undefined) {
            if (args.description.length > ITEM_LIMITS.descriptionMax) return { status: "INVALID", message: `Use a description of up to ${ITEM_LIMITS.descriptionMax} characters.` };
            next.description = args.description; section ||= "description";
          }
          if (args.priceAud !== undefined) { next.price = args.priceAud.toFixed(2); section ||= "price"; }
          if (!section) return { status: "REJECTED", message: "Send at least one of name, priceAud, code or description." };
          live = next;
          if (args.name !== undefined) setName(next.name);
          if (args.code !== undefined) setCode(next.code);
          if (args.description !== undefined) setDescription(next.description);
          if (args.priceAud !== undefined) setPrice(next.price);
          setLocalError(null);
          goToStep(1);
          setVoiceScroll({ to: section, at: Date.now() });
          const codeClash = args.code ? duplicateItemCodeError(next.code, existingItems, item?.id ?? null) : null;
          return {
            status: "OK",
            message: `Typed in. Now: ${readBack()}${codeClash ? ` Warning: ${codeClash}` : ""} Ask for anything missing, or continue.`,
          };
        }
        if (args.action === "back") {
          goToStep(1);
          setLocalError(null);
          return { status: "OK", message: "Back on step 1 (item details)." };
        }
        if (args.action === "continue") {
          const problem = live.formError({ name: live.name, price: live.price, code: live.code });
          if (problem) {
            setLocalError(problem);
            return { status: "INVALID", message: problem };
          }
          setLocalError(null);
          goToStep(2);
          return {
            status: "REVIEW",
            message: `Review step is open. Read back: ${readBack()} Say the price as dollars and cents. ` +
              `Then ask: Should I ${item ? "save these changes" : "add this item"}? Save only after a clear yes.`,
          };
        }
        // save
        if (live.currentStep !== 2) return { status: "NOT_AT_REVIEW", message: "Continue to the review step first." };
        const updatesExisting = sameName(live.name);
        const failure = await live.handleSave();
        if (failure) return { status: "NOT_SAVED", message: failure };
        return {
          status: "SAVED",
          message: item ? "The changes are saved. Tell the owner."
            : updatesExisting ? `The existing item "${updatesExisting.name}" was updated (not a new one). Tell the owner.`
              : "The item is added. Tell the owner.",
        };
      },
    });
  }, [item, existingItems]);

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

  async function handleDocumentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploadingDocument(true);
    setLocalError(null);
    const result = await uploadItemDocumentFile(file);
    setIsUploadingDocument(false);

    if (!result.ok) {
      setLocalError(result.error);
      return;
    }
    setDocumentUrl(result.documentUrl);
    setDocumentName(result.documentName);
    setDocumentFile(file);
  }

  function clearDocument() {
    setDocumentUrl(null);
    setDocumentName(null);
    setDocumentFile(null);
  }

  /**
   * Where the editor's current document can be read from, or null when it can
   * be neither proxied (unsaved item) nor read locally (untouched this session).
   */
  const documentPreviewSource: ItemDocumentPreview["source"] | null =
    documentFile
      ? { kind: "file", file: documentFile }
      : item && documentUrl === item.documentUrl
        ? { kind: "item", itemId: item.id }
        : null;

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
                ? "Add the photo, name, price and an optional document for your catalog item."
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

        <div ref={bodyRef} className="min-h-0 overflow-y-auto px-5 py-5">
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
                description="These details appear in your item catalog and quotations. You can also attach an optional PDF."
                icon="inventory_2"
              />

              <label data-voice-section="photo" className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Photo
                </span>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative mx-auto h-24 w-24 shrink-0 overflow-hidden rounded-xl border-2 border-dashed border-outline-variant bg-surface-container-low sm:mx-0">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
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

              <label data-voice-section="code" className="flex flex-col gap-2">
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

              <label data-voice-section="name" className="flex flex-col gap-2">
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
                {nameWarning ? (
                  <span className="flex items-start gap-1.5 font-body text-[12px] font-semibold text-amber-800">
                    <span className="material-symbols-outlined shrink-0 text-[14px] leading-none">
                      info
                    </span>
                    {nameWarning}
                  </span>
                ) : null}
              </label>

              <label data-voice-section="description" className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional details for quotations"
                  rows={3}
                  maxLength={500}
                  className={`${INPUT_CLASS} resize-y`}
                />
              </label>

              <label data-voice-section="price" className="flex flex-col gap-2">
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

              <div data-voice-section="document" className="flex flex-col gap-2">
                <span className="font-body text-[13px] font-semibold tracking-wide text-on-surface-variant">
                  Document{" "}
                  <span className="font-normal text-on-surface-variant/80">
                    (optional)
                  </span>
                </span>
                {documentUrl ? (
                  <div className="flex items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary">
                      <span className="material-symbols-outlined text-[22px]">
                        picture_as_pdf
                      </span>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body text-[13px] font-semibold text-on-surface">
                        {documentName ?? "Document.pdf"}
                      </p>
                      {documentPreviewSource ? (
                        <button
                          type="button"
                          onClick={() =>
                            onPreviewDocument({
                              source: documentPreviewSource,
                              url: documentUrl,
                              name: documentName,
                              itemName: name.trim() || item?.name || "Item",
                            })
                          }
                          className="font-body text-[12px] font-semibold text-primary hover:underline"
                        >
                          View document
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={clearDocument}
                      disabled={isUploadingDocument || isSaving}
                      className="rounded-lg px-2 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-error disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface-container-low px-4 py-2.5 font-body text-[13px] font-semibold text-on-surface transition-colors hover:bg-surface-container-high">
                    {isUploadingDocument ? (
                      <span className="material-symbols-outlined animate-spin text-[18px]">
                        progress_activity
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">
                        attach_file
                      </span>
                    )}
                    {isUploadingDocument ? "Uploading…" : "Upload document"}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="sr-only"
                      disabled={isUploadingDocument || isSaving}
                      onChange={(event) => void handleDocumentChange(event)}
                    />
                  </label>
                )}
                <p className="font-body text-[11px] text-on-surface-variant">
                  PDF · max 10 MB
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <ItemEditorHero
                eyebrow="Step 2 · Review"
                title="Preview before saving"
                description="Check the photo, name, price and document, then save this item."
                icon="fact_check"
              />

              <ItemPreviewPanel
                name={name.trim() || "Untitled item"}
                code={code.trim() || null}
                description={description.trim() || null}
                priceAud={previewPrice}
                imageUrl={imageUrl}
                documentUrl={documentUrl}
                documentName={documentName}
                documentSource={documentPreviewSource}
                onPreviewDocument={onPreviewDocument}
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
              disabled={isUploading || isUploadingDocument}
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
              disabled={isSaving || isUploading || isUploadingDocument}
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
  description,
  priceAud,
  imageUrl,
  documentUrl,
  documentName,
  documentSource,
  onPreviewDocument,
}: {
  name: string;
  code: string | null;
  description: string | null;
  priceAud: number;
  imageUrl: string | null;
  documentUrl: string | null;
  documentName: string | null;
  documentSource: ItemDocumentPreview["source"] | null;
  onPreviewDocument: (preview: ItemDocumentPreview) => void;
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
            // eslint-disable-next-line @next/next/no-img-element
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
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5 sm:col-span-2">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Description
          </p>
          <p className="mt-1 whitespace-pre-line font-body text-[13px] text-on-surface">
            {description ?? "—"}
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
        <div className="rounded-lg bg-surface-container-low/80 px-3 py-2.5 sm:col-span-2">
          <p className="font-body text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
            Document
          </p>
          {documentUrl && documentSource ? (
            <button
              type="button"
              onClick={() =>
                onPreviewDocument({
                  source: documentSource,
                  url: documentUrl,
                  name: documentName,
                  itemName: name,
                })
              }
              className="mt-1 inline-flex max-w-full items-center gap-1.5 font-body text-[13px] font-semibold text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[16px]">
                picture_as_pdf
              </span>
              <span className="truncate">{documentName ?? "Document.pdf"}</span>
            </button>
          ) : documentUrl ? (
            <p className="mt-1 flex items-center gap-1.5 font-body text-[13px] font-semibold text-on-surface">
              <span className="material-symbols-outlined text-[16px]">
                picture_as_pdf
              </span>
              <span className="truncate">{documentName ?? "Document.pdf"}</span>
            </p>
          ) : (
            <p className="mt-1 font-body text-[13px] font-semibold text-on-surface">
              No document
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
