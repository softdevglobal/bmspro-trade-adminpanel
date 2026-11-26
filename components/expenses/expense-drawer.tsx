"use client";

import { useAuth } from "@/lib/auth/auth-context";
import {
  ExpenseApiError,
  expenseRequest,
  patchExpense,
  uploadReceipt,
  type ExpenseOptions,
} from "@/lib/expenses/client";
import { formatExpenseDate } from "@/lib/expenses/rules";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_MISSING_LABELS,
  EXPENSE_STATUS_LABELS,
  formatExpenseAud,
  type ExpenseDuplicate,
  type ExpenseRecord,
  type ExpenseStatus,
} from "@/lib/expenses/types";
import { useRegisterRightDrawer } from "@/lib/ui/right-drawer-slot";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

const panelTransition = { type: "spring" as const, damping: 32, stiffness: 340, mass: 0.85 };

const INPUT_CLASS =
  "h-10 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 font-body text-[14px] text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60";

export function expenseStatusBadgeClass(status: ExpenseStatus): string {
  switch (status) {
    case "approved":
      return "border border-tertiary/20 bg-tertiary-container/70 text-on-tertiary-container";
    case "rejected":
      return "border border-error/20 bg-error-container/70 text-on-error-container";
    case "incomplete":
      return "border border-orange-500/20 bg-orange-100 text-orange-800";
    case "pending":
      return "border border-amber-500/20 bg-amber-100 text-amber-800";
    default:
      return "border border-outline-variant/60 bg-surface-container-high text-on-surface-variant";
  }
}

export function ExpenseStatusBadge({ expense }: { expense: ExpenseRecord }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-body text-[11px] font-semibold ${expenseStatusBadgeClass(expense.status)}`}
    >
      {expense.status === "pending" && expense.overLimit ? "Needs approval" : EXPENSE_STATUS_LABELS[expense.status]}
    </span>
  );
}

type FormState = {
  vendor: string;
  date: string;
  amountAud: string;
  gstAud: string;
  category: string;
  reason: string;
  vehicleId: string;
  jobId: string;
  paidWith: "business" | "personal";
};

function formFrom(expense: ExpenseRecord): FormState {
  return {
    vendor: expense.vendor ?? "",
    date: expense.date ?? "",
    amountAud: expense.amountAud != null ? expense.amountAud.toFixed(2) : "",
    gstAud: expense.gstAud != null ? expense.gstAud.toFixed(2) : "",
    category: expense.category,
    reason: expense.reason ?? "",
    vehicleId: expense.vehicleId ?? "",
    jobId: expense.jobId ?? "",
    paidWith: expense.paidWith,
  };
}

function fieldsFrom(form: FormState) {
  return {
    vendor: form.vendor.trim() || null,
    date: form.date || null,
    amountAud: form.amountAud.trim() ? Number(form.amountAud) : null,
    gstAud: form.gstAud.trim() ? Number(form.gstAud) : null,
    category: form.category,
    reason: form.reason.trim() || null,
    vehicleId: form.vehicleId || null,
    jobId: form.jobId || null,
    paidWith: form.paidWith,
  };
}

type NoteAction = "reject" | "request_receipt" | "mark_reimbursed";

const NOTE_DIALOG: Record<NoteAction, { title: string; body: string; button: string; required: boolean; placeholder: string }> = {
  reject: {
    title: "Reject this expense?",
    body: "The team member sees your reason in the app.",
    button: "Reject expense",
    required: true,
    placeholder: "Why is it rejected?",
  },
  request_receipt: {
    title: "Ask for the receipt or details",
    body: "The expense goes back to the team member as incomplete. Sophie reminds them until it's added.",
    button: "Send request",
    required: false,
    placeholder: "Optional note, e.g. The photo is blurry, please retake it",
  },
  mark_reimbursed: {
    title: "Record the reimbursement",
    body: "Only record this after the money has been paid back. Sophie never makes payments.",
    button: "Mark as reimbursed",
    required: false,
    placeholder: "Optional note, e.g. Paid with the 28 Nov pay run",
  },
};

export function ExpenseDrawer({
  expense,
  options,
  onClose,
  onChanged,
  onDeleted,
}: {
  expense: ExpenseRecord | null;
  options: ExpenseOptions | null;
  onClose: () => void;
  onChanged: (expense: ExpenseRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const open = expense !== null;
  useRegisterRightDrawer(open, "sm");

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence mode="wait">
      {expense ? (
        <div key={expense.id} className="fixed inset-0 z-[100]">
          <motion.button
            type="button"
            aria-label="Close expense"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-detail-title"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={panelTransition}
            onClick={(event) => event.stopPropagation()}
            className="absolute inset-y-0 right-0 flex h-full w-[calc(100%-1.25rem)] max-w-[560px] flex-col overflow-hidden rounded-l-2xl border border-y-0 border-r-0 border-l border-outline-variant bg-background shadow-2xl"
          >
            <ExpenseDetail
              key={`${expense.id}:${expense.updatedAt ?? 0}`}
              expense={expense}
              options={options}
              onClose={onClose}
              onChanged={onChanged}
              onDeleted={onDeleted}
            />
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

function ExpenseDetail({
  expense,
  options,
  onClose,
  onChanged,
  onDeleted,
}: {
  expense: ExpenseRecord;
  options: ExpenseOptions | null;
  onClose: () => void;
  onChanged: (expense: ExpenseRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const { user } = useAuth();
  const canManage = options?.canManage === true;
  const isOwn = expense.submittedBy.uid === user?.uid;
  const editable = canManage
    ? ["draft", "incomplete", "pending"].includes(expense.status)
    : isOwn && (expense.status === "draft" || expense.status === "incomplete");
  const canSubmit = (isOwn || canManage) && (expense.status === "draft" || expense.status === "incomplete");
  const canDecide = canManage && (expense.status === "pending" || expense.status === "incomplete");

  const [form, setForm] = useState<FormState>(() => formFrom(expense));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [noteAction, setNoteAction] = useState<NoteAction | null>(null);
  const [note, setNote] = useState("");
  const [duplicate, setDuplicate] = useState<{ info: ExpenseDuplicate; retry: () => Promise<void> } | null>(null);
  const [zoom, setZoom] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const dirty = JSON.stringify(fieldsFrom(form)) !== JSON.stringify(fieldsFrom(formFrom(expense)));
  const vehicles = options?.settings.vehicles ?? [];
  const jobs = options?.jobs ?? [];
  const jobInList = !expense.jobId || jobs.some((job) => job.id === expense.jobId);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * Runs an action. When the server reports a possible duplicate and the
   * action can be repeated with "allow duplicate", the person is asked first.
   */
  async function run(label: string, action: () => Promise<void>, retryAsDifferent?: () => Promise<void>) {
    if (!user) return;
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ExpenseApiError && caught.duplicate && !caught.duplicate.exact && retryAsDifferent) {
        setDuplicate({
          info: caught.duplicate,
          retry: async () => {
            setDuplicate(null);
            await run(label, retryAsDifferent);
          },
        });
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function save(): Promise<ExpenseRecord> {
    if (!user) throw new Error("Not signed in.");
    const updated = await patchExpense(user, { id: expense.id, action: "update", fields: fieldsFrom(form) });
    return updated;
  }

  const submit = () =>
    run(
      "submit",
      async () => {
        if (!user) return;
        if (dirty) await save();
        onChanged(await patchExpense(user, { id: expense.id, action: "submit" }));
      },
      async () => {
        if (!user) return;
        onChanged(await patchExpense(user, { id: expense.id, action: "submit", allowDuplicate: true }));
      },
    );

  const approve = () =>
    run("approve", async () => {
      if (!user) return;
      if (dirty) await save();
      onChanged(await patchExpense(user, { id: expense.id, action: "approve" }));
    });

  async function confirmNote() {
    const action = noteAction;
    if (!action) return;
    setNoteAction(null);
    await run(action, async () => {
      if (!user) return;
      onChanged(await patchExpense(user, { id: expense.id, action, note: note.trim() || null }));
    });
    setNote("");
  }

  async function onReceiptChosen(file: File | undefined) {
    if (!file || !user) return;
    await run(
      "receipt",
      async () => onChanged(await uploadReceipt(user, file, { expenseId: expense.id })),
      async () => onChanged(await uploadReceipt(user, file, { expenseId: expense.id, allowDuplicate: true })),
    );
  }

  const remove = () =>
    run("delete", async () => {
      if (!user) return;
      await expenseRequest(user, `/api/expenses?id=${encodeURIComponent(expense.id)}`, { method: "DELETE" });
      onDeleted(expense.id);
    });

  const request = expense.receiptRequest;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/60 bg-surface-container-low/50 px-5 py-4">
        <div className="min-w-0">
          <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">
            {expense.expenseCode}
          </p>
          <h2 id="expense-detail-title" className="truncate font-display text-[18px] font-semibold text-on-surface">
            {expense.vendor ?? "New expense"}
          </h2>
          <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
            {formatExpenseAud(expense.amountAud)} · {formatExpenseDate(expense.date)} · {expense.submittedBy.name}
          </p>
          <div className="mt-2">
            <ExpenseStatusBadge expense={expense} />
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">error</span>
            {error}
          </div>
        ) : null}

        <section className="rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-3">
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(event) => {
              void onReceiptChosen(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {expense.receipt ? (
            <div className="flex items-start gap-3">
              <button type="button" onClick={() => setZoom(true)} className="shrink-0" aria-label="View receipt">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={expense.receipt.url}
                  alt="Receipt"
                  className="h-28 w-24 rounded-lg border border-outline-variant object-cover"
                />
              </button>
              <div className="min-w-0 flex-1">
                <p className="font-body text-[13px] font-semibold text-on-surface">Receipt</p>
                <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">Tap the photo to see it full size.</p>
                {editable ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => fileInput.current?.click()}
                    className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant px-3 font-body text-[12px] font-semibold text-on-surface hover:bg-surface-container-high disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[16px]">photo_camera</span>
                    {busy === "receipt" ? "Sophie is reading it…" : "Replace receipt"}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-700">
                <span className="material-symbols-outlined text-[24px]">receipt</span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-body text-[13px] font-semibold text-on-surface">No receipt yet</p>
                <p className="font-body text-[12px] text-on-surface-variant">
                  A receipt is needed before this expense is complete.
                </p>
              </div>
              {editable ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => fileInput.current?.click()}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3 font-body text-[12px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[16px]">upload</span>
                  {busy === "receipt" ? "Reading…" : "Add receipt"}
                </button>
              ) : null}
            </div>
          )}
        </section>

        {expense.sophie ? (
          <section className="rounded-2xl border border-primary/20 bg-primary-container/15 p-3">
            <p className="flex items-center gap-1.5 font-body text-[13px] font-semibold text-on-surface">
              <span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span>
              {expense.sophie.analysed
                ? `Sophie read this receipt${expense.sophie.confidence ? ` (${expense.sophie.confidence} confidence)` : ""}`
                : "Sophie couldn't read this receipt"}
            </p>
            {expense.sophie.checks.length ? (
              <ul className="mt-2 space-y-1">
                {expense.sophie.checks.map((check) => (
                  <li key={check} className="flex gap-1.5 font-body text-[12px] text-on-surface-variant">
                    <span aria-hidden>•</span>
                    {check}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">Nothing unusual. Check the details and submit.</p>
            )}
          </section>
        ) : null}

        {expense.overLimit && (expense.status === "pending" || expense.status === "draft") ? (
          <Notice tone="amber" icon="price_check">
            Over the {formatExpenseAud(expense.limitAud)} spending limit, so the owner must approve it.
          </Notice>
        ) : null}
        {expense.status === "incomplete" ? (
          <Notice tone="orange" icon="assignment_late">
            {request?.requestedBy
              ? `${request.requestedBy.name} asked for the receipt or details${request.note ? `: “${request.note}”` : "."}`
              : `Missing: ${expense.missing.map((field) => EXPENSE_MISSING_LABELS[field]).join(", ") || "receipt"}.`}
            {request?.remindersSent ? ` Sophie has reminded ${isOwn ? "you" : expense.submittedBy.name} ${request.remindersSent} time${request.remindersSent === 1 ? "" : "s"}.` : ""}
          </Notice>
        ) : null}
        {expense.duplicateOfId ? (
          <Notice tone="neutral" icon="content_copy">
            Similar to another expense; {expense.submittedBy.name} confirmed it&apos;s a different purchase.
          </Notice>
        ) : null}
        {expense.decision ? (
          <Notice tone={expense.status === "approved" ? "green" : "red"} icon={expense.status === "approved" ? "check_circle" : "cancel"}>
            {expense.status === "approved" ? "Approved" : "Rejected"} by {expense.decision.by.name}
            {expense.decision.note ? `: “${expense.decision.note}”` : "."}
          </Notice>
        ) : null}
        {expense.reimbursement.status === "owed" ? (
          <Notice tone="amber" icon="savings">
            {expense.submittedBy.name} paid with their own money and is owed {formatExpenseAud(expense.amountAud)}.
          </Notice>
        ) : null}
        {expense.reimbursement.status === "reimbursed" ? (
          <Notice tone="green" icon="savings">
            Reimbursement recorded by {expense.reimbursement.by?.name ?? "the owner"}
            {expense.reimbursement.note ? `: “${expense.reimbursement.note}”` : "."}
          </Notice>
        ) : null}

        <section className="space-y-3">
          <h3 className="font-display text-[15px] font-semibold text-on-surface">Details</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Shop or supplier" className="sm:col-span-2">
              <input className={INPUT_CLASS} value={form.vendor} disabled={!editable} onChange={(e) => set("vendor", e.target.value)} />
            </Field>
            <Field label="Date">
              <input
                type="date"
                className={INPUT_CLASS}
                value={form.date}
                max={options?.todayIso}
                disabled={!editable}
                onChange={(e) => set("date", e.target.value)}
              />
            </Field>
            <Field label="Category">
              <select className={INPUT_CLASS} value={form.category} disabled={!editable} onChange={(e) => set("category", e.target.value)}>
                {EXPENSE_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {EXPENSE_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Total paid (incl. GST)">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={INPUT_CLASS}
                value={form.amountAud}
                disabled={!editable}
                onChange={(e) => set("amountAud", e.target.value)}
              />
            </Field>
            <Field label="GST">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className={INPUT_CLASS}
                value={form.gstAud}
                disabled={!editable}
                onChange={(e) => set("gstAud", e.target.value)}
              />
            </Field>
            <Field label="What was it for?" className="sm:col-span-2">
              <input className={INPUT_CLASS} value={form.reason} disabled={!editable} onChange={(e) => set("reason", e.target.value)} />
            </Field>
            <Field label="Vehicle">
              <select className={INPUT_CLASS} value={form.vehicleId} disabled={!editable} onChange={(e) => set("vehicleId", e.target.value)}>
                <option value="">No vehicle</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                    {vehicle.rego ? ` (${vehicle.rego})` : ""}
                  </option>
                ))}
                {expense.vehicleId && !vehicles.some((vehicle) => vehicle.id === expense.vehicleId) ? (
                  <option value={expense.vehicleId}>{expense.vehicleLabel ?? "Removed vehicle"}</option>
                ) : null}
              </select>
            </Field>
            <Field label="Job">
              <select className={INPUT_CLASS} value={form.jobId} disabled={!editable} onChange={(e) => set("jobId", e.target.value)}>
                <option value="">No job</option>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.label}
                  </option>
                ))}
                {!jobInList && expense.jobId ? <option value={expense.jobId}>{expense.jobLabel ?? "Linked job"}</option> : null}
              </select>
            </Field>
            <Field label="Paid with" className="sm:col-span-2">
              <div className="flex gap-2">
                {(["business", "personal"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!editable}
                    onClick={() => set("paidWith", value)}
                    className={`flex-1 rounded-xl border px-3 py-2 font-body text-[13px] font-semibold transition-colors disabled:opacity-60 ${
                      form.paidWith === value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {value === "business" ? "Business card or account" : "Own money (to be paid back)"}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </section>
      </div>

      <footer className="shrink-0 space-y-2 border-t border-outline-variant/60 bg-surface-container-low/50 px-5 py-3">
        <div className="flex flex-wrap justify-end gap-2">
          {expense.status === "draft" && (isOwn || canManage) ? (
            <ActionButton tone="ghost" busy={busy === "delete"} disabled={busy !== null} onClick={() => void remove()}>
              Delete draft
            </ActionButton>
          ) : null}
          {editable && dirty ? (
            <ActionButton
              tone="outline"
              busy={busy === "save"}
              disabled={busy !== null}
              onClick={() => void run("save", async () => onChanged(await save()))}
            >
              Save changes
            </ActionButton>
          ) : null}
          {canDecide ? (
            <>
              <ActionButton tone="outline" disabled={busy !== null} onClick={() => setNoteAction("request_receipt")}>
                Ask for receipt
              </ActionButton>
              <ActionButton tone="danger" disabled={busy !== null} onClick={() => setNoteAction("reject")}>
                Reject
              </ActionButton>
              <ActionButton tone="primary" busy={busy === "approve"} disabled={busy !== null} onClick={() => void approve()}>
                Approve
              </ActionButton>
            </>
          ) : null}
          {canSubmit && !canDecide ? (
            <ActionButton tone="primary" busy={busy === "submit"} disabled={busy !== null} onClick={() => void submit()}>
              {expense.status === "incomplete" ? "Resubmit" : "Submit"}
            </ActionButton>
          ) : null}
          {canManage && expense.status === "approved" && expense.reimbursement.status === "owed" ? (
            <ActionButton tone="primary" disabled={busy !== null} onClick={() => setNoteAction("mark_reimbursed")}>
              Mark as reimbursed
            </ActionButton>
          ) : null}
        </div>
        <p className="text-right font-body text-[11px] text-on-surface-variant">
          Approvals and reimbursements are made by people. Sophie only reads receipts and sends reminders.
        </p>
      </footer>

      {noteAction ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5 shadow-xl">
            <h4 className="font-display text-title-lg font-semibold text-on-surface">{NOTE_DIALOG[noteAction].title}</h4>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">{NOTE_DIALOG[noteAction].body}</p>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder={NOTE_DIALOG[noteAction].placeholder}
              className="mt-3 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface outline-none focus:border-primary"
            />
            <div className="mt-4 flex justify-end gap-2">
              <ActionButton tone="outline" onClick={() => { setNoteAction(null); setNote(""); }}>
                Cancel
              </ActionButton>
              <ActionButton
                tone={noteAction === "reject" ? "danger" : "primary"}
                disabled={NOTE_DIALOG[noteAction].required && note.trim().length < 2}
                onClick={() => void confirmNote()}
              >
                {NOTE_DIALOG[noteAction].button}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}

      {duplicate ? (
        <DuplicateDialog
          duplicate={duplicate.info}
          onCancel={() => setDuplicate(null)}
          onConfirm={() => void duplicate.retry()}
        />
      ) : null}

      {zoom && expense.receipt ? (
        <button type="button" onClick={() => setZoom(false)} className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={expense.receipt.url} alt="Receipt" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
        </button>
      ) : null}
    </div>
  );
}

export function DuplicateDialog({
  duplicate,
  onCancel,
  onConfirm,
}: {
  duplicate: ExpenseDuplicate;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-outline-variant/60 bg-surface-container-lowest p-5 shadow-xl">
        <h4 className="flex items-center gap-2 font-display text-title-lg font-semibold text-on-surface">
          <span className="material-symbols-outlined text-[22px] text-amber-600">content_copy</span>
          Possible duplicate
        </h4>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">
          Sophie found {duplicate.expenseCode} from {duplicate.submittedByName} with the same shop, date and amount:
        </p>
        <div className="mt-3 rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2 font-body text-[13px] text-on-surface">
          {duplicate.vendor ?? "Unknown shop"} · {formatExpenseDate(duplicate.date)} · {formatExpenseAud(duplicate.amountAud)} ·{" "}
          {EXPENSE_STATUS_LABELS[duplicate.status]}
        </div>
        <p className="mt-3 font-body text-[13px] text-on-surface-variant">
          If this is the same receipt, cancel and nothing is added. Only continue if it&apos;s a separate purchase.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <ActionButton tone="primary" onClick={onCancel}>
            It&apos;s the same, cancel
          </ActionButton>
          <ActionButton tone="outline" onClick={onConfirm}>
            Different purchase, add it
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className = "", children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block font-body text-[12px] font-semibold text-on-surface-variant">{label}</span>
      {children}
    </label>
  );
}

const NOTICE_TONES = {
  amber: "border-amber-400/40 bg-amber-50 text-amber-900",
  orange: "border-orange-400/40 bg-orange-50 text-orange-900",
  green: "border-tertiary/30 bg-tertiary-container/30 text-on-tertiary-container",
  red: "border-error/30 bg-error-container/40 text-on-error-container",
  neutral: "border-outline-variant/60 bg-surface-container-low text-on-surface",
} as const;

function Notice({ tone, icon, children }: { tone: keyof typeof NOTICE_TONES; icon: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 font-body text-[13px] ${NOTICE_TONES[tone]}`}>
      <span className="material-symbols-outlined mt-0.5 text-[18px]">{icon}</span>
      <p>{children}</p>
    </div>
  );
}

export function ActionButton({
  tone,
  busy = false,
  disabled = false,
  onClick,
  children,
}: {
  tone: "primary" | "outline" | "danger" | "ghost";
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const toneClass = {
    primary: "bg-primary text-on-primary hover:opacity-90",
    outline: "border border-outline-variant text-on-surface hover:bg-surface-container-high",
    danger: "bg-error text-on-error hover:opacity-90",
    ghost: "text-error hover:bg-error-container/40",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex h-10 items-center justify-center gap-1.5 rounded-xl px-4 font-body text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {busy ? <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span> : null}
      {children}
    </button>
  );
}
