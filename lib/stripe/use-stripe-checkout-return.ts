"use client";

import { readJsonResponse } from "@/lib/api/read-json-response";
import { useAuth } from "@/lib/auth/auth-context";
import type { BusinessSmsBalance } from "@/lib/sms-packages/balance";
import { useEffect, useRef } from "react";

function cleanCheckoutParamsFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", url.pathname + url.search);
}

type ConfirmResult = {
  ok?: boolean;
  alreadyFulfilled?: boolean;
  type?: "sms_topup" | "subscription" | "skipped";
  balance?: BusinessSmsBalance;
  error?: string;
};

const CONFIRMED_SESSION_STORAGE_PREFIX = "stripe-checkout-confirmed:";
const INFLIGHT_SESSION_STORAGE_PREFIX = "stripe-checkout-inflight:";

function hasConfirmedCheckoutSession(sessionId: string): boolean {
  try {
    return (
      sessionStorage.getItem(CONFIRMED_SESSION_STORAGE_PREFIX + sessionId) ===
      "1"
    );
  } catch {
    return false;
  }
}

function rememberConfirmedCheckoutSession(sessionId: string): void {
  try {
    sessionStorage.setItem(CONFIRMED_SESSION_STORAGE_PREFIX + sessionId, "1");
  } catch {
    // Ignore storage failures — server idempotency still applies.
  }
}

function tryClaimCheckoutConfirmation(sessionId: string): boolean {
  try {
    const inflightKey = INFLIGHT_SESSION_STORAGE_PREFIX + sessionId;
    if (sessionStorage.getItem(inflightKey) === "1") return false;
    sessionStorage.setItem(inflightKey, "1");
    return true;
  } catch {
    return true;
  }
}

function releaseCheckoutConfirmation(sessionId: string): void {
  try {
    sessionStorage.removeItem(INFLIGHT_SESSION_STORAGE_PREFIX + sessionId);
  } catch {
    // Ignore storage failures.
  }
}

/** After Stripe redirect, confirms payment via API (no webhook secret needed). */
export function useStripeCheckoutReturn(options?: {
  onSuccess?: (result: ConfirmResult) => void | Promise<void>;
  onCanceled?: () => void;
  onError?: (message: string) => void;
}) {
  const { user } = useAuth();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!user) return;

    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id")?.trim();

    if (checkout === "canceled") {
      cleanCheckoutParamsFromUrl();
      optionsRef.current?.onCanceled?.();
      return;
    }

    if (checkout !== "success" || !sessionId) return;

    if (!tryClaimCheckoutConfirmation(sessionId)) return;

    void (async () => {
      try {
        if (hasConfirmedCheckoutSession(sessionId)) {
          await optionsRef.current?.onSuccess?.({
            ok: true,
            alreadyFulfilled: true,
          });
          return;
        }

        const token = await user.getIdToken();
        const res = await fetch("/api/stripe/checkout/confirm", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ sessionId }),
        });
        const data = await readJsonResponse<ConfirmResult>(res);

        if (!res.ok || !data.ok) {
          optionsRef.current?.onError?.(
            data.error ?? "Could not confirm payment.",
          );
          return;
        }

        rememberConfirmedCheckoutSession(sessionId);
        await optionsRef.current?.onSuccess?.(data);
      } catch {
        optionsRef.current?.onError?.("Could not confirm payment.");
      } finally {
        releaseCheckoutConfirmation(sessionId);
        cleanCheckoutParamsFromUrl();
      }
    })();
  }, [user]);
}
