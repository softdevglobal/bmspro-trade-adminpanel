"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CopySectionOption } from "@/lib/copy-data/format";

type Props<T extends string> = {
  open: boolean;
  title: string;
  sections: CopySectionOption<T>[];
  onClose: () => void;
  onCopy: (selectedIds: T[]) => void | Promise<void>;
};

export function CopyDataModal<T extends string>({
  open,
  title,
  sections,
  onClose,
  onCopy,
}: Props<T>) {
  const titleId = useId();
  const [selected, setSelected] = useState<Set<T>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelected(
      new Set(
        sections.filter((section) => section.defaultChecked).map((s) => s.id),
      ),
    );
    setBusy(false);
    setCopied(false);
    setError(null);
    // Re-init only when the dialog opens; section options are stable per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sections captured at open
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [open, onClose]);

  const enabledSections = useMemo(
    () => sections.filter((section) => !section.disabled),
    [sections],
  );

  const allEnabledSelected =
    enabledSections.length > 0 &&
    enabledSections.every((section) => selected.has(section.id));

  if (!open) return null;

  function toggle(id: T, disabled: boolean) {
    if (disabled) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(enabledSections.map((section) => section.id)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  async function handleCopy() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onCopy([...selected]);
      setCopied(true);
      window.setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not copy to clipboard.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-on-background/50 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-outline-variant/60 px-5 py-4">
          <h2
            id={titleId}
            className="font-display text-[18px] font-semibold text-on-surface"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <div className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="font-body text-[13px] text-on-surface-variant">
              Choose which sections to copy.
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={allEnabledSelected ? clearAll : selectAll}
                disabled={enabledSections.length === 0}
                className="font-body text-[12px] font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              >
                {allEnabledSelected ? "Clear" : "Select all"}
              </button>
            </div>
          </div>

          <ul className="space-y-1.5">
            {sections.map((section) => {
              const checked = selected.has(section.id);
              const inputId = `${titleId}-${section.id}`;
              return (
                <li key={section.id}>
                  <label
                    htmlFor={inputId}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                      section.disabled
                        ? "cursor-not-allowed border-outline-variant/30 bg-surface-container-low/50 opacity-60"
                        : checked
                          ? "border-primary/40 bg-primary/5"
                          : "border-outline-variant/60 bg-surface-container-lowest hover:bg-surface-container-low"
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      checked={checked}
                      disabled={section.disabled}
                      onChange={() => toggle(section.id, section.disabled)}
                      className="h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary/30"
                    />
                    <span className="min-w-0 flex-1 font-body text-[14px] font-semibold text-on-surface">
                      {section.label}
                    </span>
                    {section.disabled ? (
                      <span className="font-body text-[11px] text-on-surface-variant">
                        Empty
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] text-rose-700"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex flex-col gap-2 border-t border-outline-variant/60 px-5 py-4">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={busy || selected.size === 0 || copied}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "Copied!" : busy ? "Copying…" : "Copy to clipboard"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2 font-body text-[13px] font-semibold text-on-surface-variant hover:text-on-surface"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
