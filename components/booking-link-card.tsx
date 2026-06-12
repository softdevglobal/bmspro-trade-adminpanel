"use client";

import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import { AnimatePresence, motion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

type BusinessSummary = {
  businessName: string;
  bookingSlug: string | null;
  bookingPath: string | null;
};

type Variant = "ephemeral" | "permanent";

type Props = {
  /**
   * `ephemeral` — show only on the first dashboard visit after onboarding,
   * auto-hides after `autoHideSeconds` seconds, then never reappears on
   * this device.
   * `permanent` — always render (e.g. on the settings page).
   */
  variant?: Variant;
  autoHideSeconds?: number;
};

const STORAGE_KEY_PREFIX = "bms.bookingLinkSeen.";

function subscribeToStorage(notify: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function getServerSnapshot(): boolean {
  return false;
}

function useSeenInStorage(businessId: string | null): boolean {
  const getSnapshot = useCallback(() => {
    if (!businessId || typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${businessId}`) === "1"
    );
  }, [businessId]);
  return useSyncExternalStore(
    subscribeToStorage,
    getSnapshot,
    getServerSnapshot
  );
}

export function BookingLinkCard({
  variant = "permanent",
  autoHideSeconds = 30,
}: Props) {
  const { role, businessId } = useAuth();
  const profile = useBusinessProfile();
  const [copied, setCopied] = useState(false);

  const data: BusinessSummary | null =
    role === "business_owner" && profile
      ? {
          businessName: profile.businessName ?? "",
          bookingSlug: profile.bookingSlug,
          bookingPath: profile.bookingPath,
        }
      : null;

  // Ephemeral-mode state: derived from localStorage + a session-only "dismissed" flag.
  const seenInStorage = useSeenInStorage(businessId);
  const [dismissed, setDismissed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(autoHideSeconds);

  const dismissEphemeral = useCallback(() => {
    if (variant !== "ephemeral") return;
    if (typeof window !== "undefined" && businessId) {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${businessId}`, "1");
    }
    setDismissed(true);
  }, [variant, businessId]);

  const ephemeralVisible =
    variant === "ephemeral" &&
    !seenInStorage &&
    !dismissed &&
    Boolean(data?.bookingSlug);

  // Countdown — only ticks while the card is visible.
  useEffect(() => {
    if (!ephemeralVisible) return;

    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          dismissEphemeral();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [ephemeralVisible, dismissEphemeral]);

  if (role !== "business_owner") return null;
  if (!data || !data.bookingSlug || !data.bookingPath) return null;
  if (variant === "ephemeral" && !ephemeralVisible) return null;

  const path = data.bookingPath;
  const fullUrl =
    typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
  const display = fullUrl.replace(/^https?:\/\//, "");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }

  const cardContent = (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-on-primary shadow-md">
          <span className="material-symbols-outlined material-symbols-filled text-[26px]">
            event_available
          </span>
        </div>
        <div className="min-w-0">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
            Booking engine
          </p>
          <h3 className="mt-0.5 font-display text-headline-sm font-semibold text-on-surface">
            {variant === "ephemeral"
              ? "Your public booking link is live"
              : "Public booking link"}
          </h3>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            {variant === "ephemeral"
              ? "Share this link with customers — bookings flow straight into your dashboard."
              : "Share this with customers. They can request a booking and it will land in your dashboard."}
          </p>
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <a
          href={path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 py-2.5 font-mono text-[12px] text-primary transition-colors hover:bg-surface-container"
        >
          <span className="material-symbols-outlined shrink-0 text-[16px]">link</span>
          <span className="min-w-0 truncate">{display}</span>
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-body text-label-bold text-on-primary transition-colors hover:bg-primary/90"
        >
          <span className="material-symbols-outlined text-[18px]">
            {copied ? "check" : "content_copy"}
          </span>
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
    </div>
  );

  if (variant === "permanent") {
    return (
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-fixed via-primary-fixed-dim to-surface-container-lowest px-4 py-4 shadow-sm sm:px-6 sm:py-5">
        {cardContent}
      </section>
    );
  }

  // Ephemeral card — animated, with a 30s progress bar and dismiss button.
  const progress = Math.max(0, Math.min(1, secondsLeft / autoHideSeconds));

  return (
    <AnimatePresence>
      {ephemeralVisible ? (
        <motion.section
          key="booking-link-ephemeral"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          className="relative mb-8 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-fixed via-primary-fixed-dim to-surface-container-lowest p-card-padding"
        >
          <button
            type="button"
            onClick={dismissEphemeral}
            aria-label="Dismiss"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-low"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>

          {cardContent}

          <div className="mt-5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-primary/15">
              <motion.div
                initial={{ width: "100%" }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 1, ease: "linear" }}
                className="h-full bg-primary"
              />
            </div>
            <p className="font-body text-[11px] font-semibold text-on-surface-variant">
              Hides in {secondsLeft}s
            </p>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
