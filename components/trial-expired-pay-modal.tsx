"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import { isStripeCheckoutEnabled } from "@/lib/stripe/public";
import { useStripeCheckoutReturn } from "@/lib/stripe/use-stripe-checkout-return";
import {
  isTrialEndedRequiringPayment,
} from "@/lib/subscription-plans/access";
import { useTenantSubscription } from "@/lib/subscription/tenant-subscription-context";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

function formatLongDate(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Full-screen paywall popup when trial ends or subscription payment is required. */
export function TrialExpiredPayModal() {
  const { user, role, status, logout } = useAuth();
  const { subscription, accessBlocked, loading, refresh } = useTenantSubscription();
  const [mounted, setMounted] = useState(false);
  const [paying, setPaying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = role === "business_owner" && status === "authenticated";
  const showModal =
    isOwner &&
    !loading &&
    accessBlocked &&
    Boolean(subscription?.planId);

  const trialEnded = subscription
    ? isTrialEndedRequiringPayment(subscription)
    : false;

  useStripeCheckoutReturn({
    onSuccess: () => {
      void refresh();
    },
    onError: (message) => setError(message),
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!showModal) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [showModal]);

  const startCheckout = useCallback(async () => {
    if (!user || !subscription?.planId) return;
    setPaying(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/stripe/checkout/subscription", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          planId: subscription.planId,
          successPath: "/dashboard/subscription?checkout=success",
          cancelPath: "/dashboard/subscription?checkout=canceled",
        }),
      });
      const data = await readJsonResponse<{
        ok?: boolean;
        url?: string;
        error?: string;
      }>(res);
      if (!res.ok || !data.ok || !data.url) {
        setError(data.error ?? "Could not start checkout.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Could not start checkout.");
    } finally {
      setPaying(false);
    }
  }, [subscription?.planId, user]);

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    setError(null);
    try {
      await logout();
    } catch {
      setError("Could not sign out. Please try again.");
      setSigningOut(false);
    }
  }, [logout]);

  if (!showModal || !mounted || !subscription) return null;

  const stripeReady = isStripeCheckoutEnabled();
  const planLabel = subscription.planName ?? "your plan";
  const trialEndLabel = formatLongDate(subscription.trialEnd);
  const title = trialEnded ? "Free trial ended" : "Subscription payment required";
  const description = trialEnded
    ? trialEndLabel
      ? `Your trial ended on ${trialEndLabel}. Pay and renew ${planLabel} to restore full access to your workshop dashboard.`
      : `Your free trial has ended. Pay and renew ${planLabel} to restore full access to your workshop dashboard.`
    : `Your subscription needs to be renewed. Pay and renew ${planLabel} to restore full access to your workshop dashboard.`;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-on-background/70 backdrop-blur-sm"
        aria-hidden
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="trial-expired-title"
        aria-describedby="trial-expired-desc"
        className="relative w-full max-w-[440px] overflow-hidden rounded-2xl border border-rose-200 bg-surface-container-lowest shadow-2xl"
      >
        <div className="px-6 pt-6 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <span className="material-symbols-outlined text-[28px]">
              event_busy
            </span>
          </div>
          <h2
            id="trial-expired-title"
            className="font-display text-[20px] font-bold text-on-surface"
          >
            {title}
          </h2>
          <p
            id="trial-expired-desc"
            className="mt-2 font-body text-[14px] leading-relaxed text-on-surface-variant"
          >
            {description}
          </p>
          {error ? (
            <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] font-semibold text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2 border-t border-outline-variant bg-surface-container-low px-6 py-4">
          {stripeReady ? (
            <button
              type="button"
              onClick={() => void startCheckout()}
              disabled={paying || signingOut}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#1a1d24] font-body text-[14px] font-semibold text-white transition-colors hover:bg-[#2a2f3a] disabled:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">
                {paying ? "progress_activity" : "payments"}
              </span>
              {paying ? "Redirecting to Stripe…" : "Pay & renew"}
            </button>
          ) : (
            <p className="text-center font-body text-[13px] text-on-surface-variant">
              Online billing is not configured. Contact support to renew your
              subscription.
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={paying || signingOut}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-outline-variant bg-white font-body text-[14px] font-semibold text-on-surface transition-colors hover:bg-surface-container-low disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-[18px]">
              {signingOut ? "progress_activity" : "logout"}
            </span>
            {signingOut ? "Signing out…" : "Log out"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
