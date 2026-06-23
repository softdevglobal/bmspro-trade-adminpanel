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

/** After Stripe redirect, confirms payment via API (no webhook secret needed). */
export function useStripeCheckoutReturn(options?: {
  onSuccess?: (result: ConfirmResult) => void | Promise<void>;
  onCanceled?: () => void;
  onError?: (message: string) => void;
}) {
  const { user } = useAuth();
  const handledRef = useRef(false);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!user || handledRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const sessionId = params.get("session_id")?.trim();

    if (checkout === "canceled") {
      handledRef.current = true;
      cleanCheckoutParamsFromUrl();
      optionsRef.current?.onCanceled?.();
      return;
    }

    if (checkout !== "success" || !sessionId) return;

    let cancelled = false;
    let completed = false;

    void (async () => {
      if (handledRef.current) return;
      handledRef.current = true;

      try {
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
        if (cancelled) return;

        if (!res.ok || !data.ok) {
          optionsRef.current?.onError?.(
            data.error ?? "Could not confirm payment.",
          );
          return;
        }

        await optionsRef.current?.onSuccess?.(data);
        completed = true;
      } catch {
        if (!cancelled) {
          optionsRef.current?.onError?.("Could not confirm payment.");
        }
      } finally {
        if (!cancelled) cleanCheckoutParamsFromUrl();
      }
    })();

    return () => {
      cancelled = true;
      if (!completed) {
        handledRef.current = false;
      }
    };
  }, [user]);
}
