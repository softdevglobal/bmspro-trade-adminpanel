"use client";

import type { PublicPaymentContext } from "@/lib/payments/public";
import { useEffect, useState } from "react";

type Phase =
  | "view"
  | "redirecting"
  | "confirming"
  | "processing"
  | "paid"
  | "error";

function formatAud(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(ms: number | null): string | null {
  if (!ms) return null;
  try {
    return new Intl.DateTimeFormat("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

export function PublicPaymentCheckout({
  context,
  initialStatus,
  sessionId,
}: {
  context: PublicPaymentContext;
  initialStatus: "success" | "cancelled" | null;
  sessionId: string | null;
}) {
  const shouldConfirm =
    !context.alreadyPaid && initialStatus === "success" && Boolean(sessionId);
  const [phase, setPhase] = useState<Phase>(
    context.alreadyPaid ? "paid" : shouldConfirm ? "confirming" : "view",
  );
  const [message, setMessage] = useState<string | null>(
    context.alreadyPaid
      ? null
      : initialStatus === "cancelled"
        ? "Payment was cancelled. You can try again below."
        : context.disabledReason,
  );

  async function startPayment() {
    setPhase("redirecting");
    setMessage(null);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: context.token }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        url?: string;
        error?: string;
      };
      if (!res.ok || !data.ok || !data.url) {
        throw new Error(data.error ?? "Could not start the payment.");
      }
      window.location.href = data.url;
    } catch (err) {
      setPhase("error");
      setMessage(
        err instanceof Error ? err.message : "Could not start the payment.",
      );
    }
  }

  useEffect(() => {
    if (!shouldConfirm) return;
    let cancelled = false;

    // Redirect-return fallback: poll confirm until the webhook settles it.
    async function run() {
      try {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const res = await fetch("/api/payments/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: context.token, sessionId }),
          });
          const data = (await res.json()) as {
            ok?: boolean;
            status?: string;
          };
          if (cancelled) return;
          if (res.ok && data.ok && data.status === "paid") {
            setPhase("paid");
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        if (cancelled) return;
        setPhase("processing");
        setMessage(
          "Your payment is processing. This page will update once it settles.",
        );
      } catch {
        if (cancelled) return;
        setPhase("processing");
        setMessage(
          "We couldn't confirm the payment just yet. If you were charged, it will update shortly.",
        );
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // If the browser restores this page from bfcache (e.g. the customer hits
    // Back from Stripe Checkout before paying), the button is still frozen
    // mid-redirect from before we navigated away. Reset it so it's usable again.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        setPhase((current) => (current === "redirecting" ? "view" : current));
      }
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const { amounts, business } = context;
  const showFee = amounts.feeCents > 0;
  const paidDate = formatDate(context.paidAt);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="overflow-hidden rounded-2xl border border-outline-variant/70 bg-surface-container-lowest shadow-sm">
        {/* Business header */}
        <div className="flex items-center gap-3 border-b border-outline-variant/50 px-5 py-4">
          {business.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={business.logoUrl}
              alt={business.name}
              className="h-10 w-10 rounded-lg object-cover"
            />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[22px]">
                storefront
              </span>
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate font-display text-[15px] font-semibold text-on-surface">
              {business.name}
            </p>
            {business.email || business.phone ? (
              <p className="truncate font-body text-[12px] text-on-surface-variant">
                {business.email ?? business.phone}
              </p>
            ) : null}
          </div>
        </div>

        <div className="px-5 py-5">
          {phase === "paid" ? (
            <PaidState
              title={context.title}
              reference={context.reference}
              paymentReference={context.paymentReference}
              paidDate={paidDate}
              totalAud={amounts.totalAud}
            />
          ) : (
            <>
              <p className="font-body text-[12px] uppercase tracking-wide text-on-surface-variant">
                {context.title}
              </p>
              <p className="mt-1 font-body text-[13px] text-on-surface">
                Hi {context.customerName}, here&apos;s your payment summary for{" "}
                <span className="font-semibold">{context.reference}</span>.
              </p>

              {/* Amount breakdown */}
              <div className="mt-4 space-y-2 rounded-xl border border-outline-variant/60 bg-surface-container-low/60 px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <span className="font-body text-[13px] text-on-surface-variant">
                    {context.type === "quotation" ? "Deposit amount" : "Amount"}
                  </span>
                  <span className="font-body text-[13px] font-medium text-on-surface">
                    {formatAud(amounts.baseAud)}
                  </span>
                </div>
                {showFee ? (
                  <div className="flex items-center justify-between">
                    <span className="font-body text-[13px] text-on-surface-variant">
                      Card processing fee
                    </span>
                    <span className="font-body text-[13px] font-medium text-on-surface">
                      +{formatAud(amounts.feeAud)}
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center justify-between border-t border-outline-variant/50 pt-2">
                  <span className="font-body text-[14px] font-semibold text-on-surface">
                    Total to pay
                  </span>
                  <span className="font-display text-[18px] font-bold text-on-surface">
                    {formatAud(amounts.totalAud)}
                  </span>
                </div>
              </div>

              {showFee ? (
                <p className="mt-2 font-body text-[11px] text-on-surface-variant">
                  A card processing fee is included so {business.name} receives
                  the full {formatAud(amounts.baseAud)}.
                </p>
              ) : null}

              <button
                type="button"
                disabled={
                  !context.canPay ||
                  phase === "redirecting" ||
                  phase === "confirming"
                }
                onClick={() => void startPayment()}
                className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 font-body text-[14px] font-semibold text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === "redirecting" ? (
                  "Redirecting to secure checkout…"
                ) : phase === "confirming" ? (
                  "Confirming payment…"
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">
                      lock
                    </span>
                    Pay {formatAud(amounts.totalAud)}
                  </>
                )}
              </button>

              <p className="mt-3 flex items-center justify-center gap-1.5 font-body text-[11px] text-on-surface-variant">
                <span className="material-symbols-outlined text-[14px]">
                  verified_user
                </span>
                Secure payment powered by Stripe
              </p>
            </>
          )}

          {message ? (
            <p
              className={`mt-4 rounded-lg px-3 py-2 font-body text-[12px] ${
                phase === "error"
                  ? "bg-error/10 font-semibold text-error"
                  : "bg-surface-container text-on-surface-variant"
              }`}
            >
              {message}
            </p>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function PaidState({
  title,
  reference,
  paymentReference,
  paidDate,
  totalAud,
}: {
  title: string;
  reference: string;
  paymentReference: string | null;
  paidDate: string | null;
  totalAud: number;
}) {
  return (
    <div className="flex flex-col items-center py-2 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[32px]">
          check_circle
        </span>
      </span>
      <p className="mt-3 font-display text-[17px] font-semibold text-on-surface">
        Payment received
      </p>
      <p className="mt-1 font-body text-[13px] text-on-surface-variant">
        {title} for {reference} has been paid.
      </p>
      <div className="mt-4 w-full space-y-1.5 rounded-xl border border-outline-variant/60 bg-surface-container-low/60 px-4 py-3 text-left">
        <div className="flex items-center justify-between">
          <span className="font-body text-[12px] text-on-surface-variant">
            Amount paid
          </span>
          <span className="font-body text-[13px] font-semibold text-on-surface">
            {formatAud(totalAud)}
          </span>
        </div>
        {paidDate ? (
          <div className="flex items-center justify-between">
            <span className="font-body text-[12px] text-on-surface-variant">
              Date
            </span>
            <span className="font-body text-[13px] text-on-surface">
              {paidDate}
            </span>
          </div>
        ) : null}
        {paymentReference ? (
          <div className="flex items-center justify-between gap-3">
            <span className="font-body text-[12px] text-on-surface-variant">
              Reference
            </span>
            <span className="truncate font-mono text-[11px] text-on-surface-variant">
              {paymentReference}
            </span>
          </div>
        ) : null}
      </div>
      <p className="mt-3 font-body text-[11px] text-on-surface-variant">
        A receipt has been emailed to you by Stripe.
      </p>
    </div>
  );
}
