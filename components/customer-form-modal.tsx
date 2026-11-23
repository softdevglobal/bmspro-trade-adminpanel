"use client";

/**
 * Add / Edit customer popup (Customers page).
 * Step 1 Details, step 2 Review. Sophie (Talk to Sophie) can drive it by voice through
 * registerCustomerStepHandler (lib/ai/owner-call/owner-customer.ts).
 */
import { useAuth } from "@/lib/auth/auth-context";
import { registerCustomerStepHandler } from "@/lib/ai/owner-call/owner-customer";
import {
  CUSTOMERS_CHANGED_EVENT,
  EMPTY_CUSTOMER_FORM,
  sameCustomer,
  validateCustomerForm,
  type CustomerFormInput,
} from "@/lib/customer/form";
import type { CustomerProfile } from "@/lib/customer/types";
import { formatAuPhoneDisplay } from "@/lib/phone/au-phone";
import { FormEvent, useEffect, useRef, useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-body text-[14px] text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:bg-surface-container-low disabled:text-on-surface-variant";

type Step = 1 | 2;

function formFromCustomer(customer: CustomerProfile): CustomerFormInput {
  return {
    fullName: customer.fullName,
    email: customer.email,
    phone: customer.phone,
    company: customer.company ?? "",
    notes: customer.notes ?? "",
    address: customer.address ?? null,
  };
}

/** Finds an existing customer with the same email or phone (never the one being edited). */
function findDuplicate(
  form: CustomerFormInput,
  existing: CustomerProfile[],
  editingUid: string | null,
): { customer: CustomerProfile; matchedOn: "email" | "phone" } | null {
  for (const customer of existing) {
    if (customer.uid === editingUid) continue;
    const matchedOn = sameCustomer(editingUid ? { email: "", phone: form.phone } : form, customer);
    if (matchedOn) return { customer, matchedOn };
  }
  return null;
}

export function CustomerFormModal({
  customer,
  existing,
  onClose,
  onSaved,
}: {
  /** Null to add a new customer; a customer to edit. */
  customer: CustomerProfile | null;
  /** The business's registered customers, for the duplicate check. */
  existing: CustomerProfile[];
  onClose: () => void;
  onSaved: (customer: CustomerProfile) => void;
}) {
  const { user } = useAuth();
  const isEdit = customer !== null;
  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<CustomerFormInput>(() => (customer ? formFromCustomer(customer) : EMPTY_CUSTOMER_FORM));
  const [sendInvite, setSendInvite] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // The voice handler reads the latest values from refs.
  const formRef = useRef(form);
  const stepRef = useRef(step);
  const inviteRef = useRef(sendInvite);
  const saveRef = useRef<() => Promise<string | null>>(async () => null);

  const duplicate = findDuplicate(form, existing, customer?.uid ?? null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  function patch(next: Partial<CustomerFormInput>) {
    setForm((current) => ({ ...current, ...next }));
  }

  /** Details check for the step: the shared rules plus the duplicate rule. Null when fine. */
  function problem(value: CustomerFormInput): string | null {
    const checked = validateCustomerForm(value);
    if (!checked.ok) return checked.error;
    const found = findDuplicate(checked.value, existing, customer?.uid ?? null);
    if (found) {
      return `${found.customer.fullName || "A customer"} already has this ${found.matchedOn}. Open that customer instead of adding a new one.`;
    }
    return null;
  }

  function handleContinue() {
    setErrorMessage(null);
    const error = problem(form);
    if (error) {
      setErrorMessage(error);
      return;
    }
    setStep(2);
  }

  /** Saves the customer. Returns null when saved, otherwise the reason it was not (also shown in the popup). */
  async function handleSave(): Promise<string | null> {
    if (isSubmitting) return "Already saving.";
    if (step !== 2) return "The review step is not open.";
    setErrorMessage(null);
    const checked = validateCustomerForm(form);
    if (!checked.ok) {
      setErrorMessage(checked.error);
      return checked.error;
    }
    if (!user) return "Please sign in again.";
    setIsSubmitting(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(isEdit ? `/api/customers/${customer.uid}` : "/api/customers", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(isEdit ? checked.value : { ...checked.value, sendInvite }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; customer?: CustomerProfile };
      if (!response.ok || data.ok === false || !data.customer) {
        const message = typeof data.error === "string" ? data.error : "Could not save the customer.";
        setErrorMessage(message);
        return message;
      }
      window.dispatchEvent(new Event(CUSTOMERS_CHANGED_EVENT));
      onSaved(data.customer);
      onClose();
      return null;
    } catch {
      setErrorMessage("Network error. Please try again.");
      return "Network error. Please try again.";
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    formRef.current = form;
    stepRef.current = step;
    inviteRef.current = sendInvite;
    saveRef.current = handleSave;
  });

  // Sophie (voice) can fill the form and press Continue / Back / Save, like the owner would.
  useEffect(() => {
    return registerCustomerStepHandler(async (args) => {
      setErrorMessage(null);
      const { action } = args;
      let next = formRef.current;
      const has = (key: keyof typeof args) => args[key] !== undefined;
      if (has("fullName") || has("email") || has("phone") || has("notes")) {
        next = {
          ...next,
          ...(has("fullName") ? { fullName: args.fullName ?? "" } : {}),
          // The email is the customer's login, so it is locked when editing.
          ...(has("email") && !isEdit ? { email: args.email ?? "" } : {}),
          ...(has("phone") ? { phone: args.phone ?? "" } : {}),
          ...(has("notes") ? { notes: args.notes ?? "" } : {}),
        };
        formRef.current = next;
        setForm(next);
      }
      if (has("sendInvite") && !isEdit) {
        inviteRef.current = args.sendInvite === true;
        setSendInvite(args.sendInvite === true);
      }
      const current = stepRef.current;

      if (action === "fill") {
        const missing = [
          !next.fullName.trim() ? "name" : null,
          !next.phone.trim() ? "mobile" : null,
          !next.email.trim() ? "email" : null,
        ].filter(Boolean);
        return {
          status: "OK",
          message: `Typed into the form. Still missing: ${missing.length ? missing.join(", ") : "nothing"}. ` +
            (isEdit ? "The email is locked." : "") + " Ask for anything missing, or ask if they want to continue.",
        };
      }
      if (action === "back") {
        stepRef.current = 1;
        setStep(1);
        return { status: "OK", message: "Went back to the details step." };
      }
      if (action === "continue") {
        if (current === 2) return { status: "OK", message: "Already on the review step." };
        const error = (() => {
          const checked = validateCustomerForm(next);
          if (!checked.ok) return { status: "INVALID", message: checked.error };
          const found = findDuplicate(checked.value, existing, customer?.uid ?? null);
          return found
            ? { status: "DUPLICATE", message: `${found.customer.fullName || "A customer"} already has this ${found.matchedOn}. Do not add them again; tell the owner.` }
            : null;
        })();
        if (error) return error;
        stepRef.current = 2;
        setStep(2);
        const checked = validateCustomerForm(next);
        const v = checked.ok ? checked.value : next;
        return {
          status: "REVIEW",
          message: `Review step is open. Read back: name "${v.fullName}", mobile ${formatAuPhoneDisplay(v.phone) || v.phone}, ` +
            `and SPELL the email letter by letter: ${v.email.split("").join(" ")}. ` +
            `Then ask: Should I ${isEdit ? "save these changes" : "add this customer"}? Call save only after a clear yes.`,
        };
      }
      // save
      if (stepRef.current !== 2) return { status: "NOT_AT_REVIEW", message: "Continue to the review step first." };
      const failure = await saveRef.current();
      return failure
        ? { status: "NOT_SAVED", message: failure }
        : { status: "SAVED", message: isEdit ? "The changes were saved. Tell the owner." : "The customer was added. Tell the owner." };
    });
  }, [isEdit, customer?.uid, existing]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 1) handleContinue();
    else void handleSave();
  }

  const reviewRows: { label: string; value: string }[] = [
    { label: "Name", value: form.fullName.trim() },
    { label: "Email", value: form.email.trim() },
    { label: "Mobile", value: formatAuPhoneDisplay(form.phone) || form.phone.trim() },
    { label: "Notes", value: form.notes.trim() },
  ].filter((row) => row.value);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-hidden overscroll-contain p-0 sm:items-center sm:p-4">
      <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute inset-0 bg-on-background/50 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 grid max-h-[94dvh] w-full max-w-2xl grid-rows-[auto_1fr_auto] overflow-hidden rounded-t-2xl border border-outline-variant bg-background shadow-2xl sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant bg-surface/90 px-5 py-4 backdrop-blur-md sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="font-body text-[12px] font-semibold uppercase tracking-wider text-primary">Step {step} of 2</p>
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">{isEdit ? "Edit customer" : "Add customer"}</h2>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-variant sm:max-w-md">
              <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${step * 50}%` }} />
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low">
            <span className="material-symbols-outlined">close</span>
          </button>
        </header>

        <form id="customer-form" onSubmit={handleSubmit} className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">
          {errorMessage && (
            <div role="alert" className="mb-5 flex items-start gap-2 rounded-lg border border-error/30 bg-error-container/60 px-3 py-2.5 font-body text-[13px] text-on-error-container">
              <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[18px] text-error">error</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-[13px] font-semibold text-on-surface">Full name <span className="text-error">*</span></span>
                <input className={INPUT_CLASS} value={form.fullName} onChange={(e) => patch({ fullName: e.target.value })} placeholder="e.g. Nira Jay" autoFocus />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-[13px] font-semibold text-on-surface">Mobile <span className="text-error">*</span></span>
                  <input className={INPUT_CLASS} value={form.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="04xx xxx xxx" inputMode="tel" />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-body text-[13px] font-semibold text-on-surface">Email <span className="text-error">*</span></span>
                  <input
                    className={INPUT_CLASS}
                    type="email"
                    value={form.email}
                    onChange={(e) => patch({ email: e.target.value })}
                    placeholder="name@example.com"
                    disabled={isEdit}
                  />
                  {isEdit && <span className="font-body text-[12px] text-on-surface-variant">The email is the customer&apos;s login and cannot be changed here.</span>}
                </label>
              </div>
              {duplicate && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 font-body text-[13px] text-amber-900">
                  <strong>{duplicate.customer.fullName || "A customer"}</strong> already has this {duplicate.matchedOn}. Open them from the list instead of adding a new customer.
                </div>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="font-body text-[13px] font-semibold text-on-surface">Notes <span className="font-normal text-on-surface-variant">(only you can see these)</span></span>
                <textarea className={INPUT_CLASS} rows={3} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <header>
                <h3 className="font-display text-headline-sm font-semibold text-on-surface">Review</h3>
                <p className="mt-1 font-body text-body-md text-on-surface-variant">Check the details before saving.</p>
              </header>
              <dl className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant/60 bg-surface-container-lowest">
                {reviewRows.map((row) => (
                  <div key={row.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[8rem_1fr]">
                    <dt className="font-body text-[12px] font-semibold uppercase tracking-wider text-on-surface-variant">{row.label}</dt>
                    <dd className="break-words font-body text-[14px] text-on-surface">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {!isEdit && (
                <label className="flex items-start gap-3 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-4 py-3">
                  <input type="checkbox" className="mt-1" checked={sendInvite} onChange={(e) => setSendInvite(e.target.checked)} />
                  <span className="font-body text-[14px] text-on-surface">
                    Email an invitation to the booking portal now
                    <span className="mt-0.5 block text-[12px] text-on-surface-variant">On by default. Untick it if the customer should not be emailed yet.</span>
                  </span>
                </label>
              )}
            </div>
          )}
        </form>

        <footer className="flex items-center justify-between gap-3 border-t border-outline-variant bg-surface/90 px-5 py-3 sm:px-6">
          {step === 2 ? (
            <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[14px] font-semibold text-on-surface hover:bg-surface-container-low">Back</button>
          ) : (
            <button type="button" onClick={onClose} className="rounded-lg border border-outline-variant px-4 py-2.5 font-body text-[14px] font-semibold text-on-surface hover:bg-surface-container-low">Cancel</button>
          )}
          <button
            type="submit"
            form="customer-form"
            disabled={isSubmitting}
            className="rounded-lg bg-primary px-5 py-2.5 font-body text-[14px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-60"
          >
            {step === 1 ? "Continue" : isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add customer"}
          </button>
        </footer>
      </div>
    </div>
  );
}
