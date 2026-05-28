"use client";

import {
  CustomerTopNav,
  type CustomerAccountTab,
} from "@/components/customer-account-nav";
import { CustomerAuthGate } from "@/components/customer-auth-gate";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import {
  buildCustomerNotifications,
  countUnread,
  readLastSeenAt,
  writeLastSeenAt,
  type CustomerNotification,
} from "@/lib/customer/notifications";
import {
  STATUS_LABELS,
  TIME_RANGE_SHORT_LABELS,
  formatSlotDate,
  type InspectionRequestStatus,
} from "@/lib/inspection/types";
import type { CustomerBooking } from "@/app/api/customer/bookings/route";
import {
  CustomerBookingShell,
  CustomerShellPanel,
} from "@/components/customer-booking-shell";
import Link from "next/link";
import {
  accountPath,
  parseLegacyAccountTabQuery,
} from "@/lib/customer/booking-routes";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  owner_proposed: "border-violet-200 bg-violet-50 text-violet-800",
  scheduled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cancelled: "border-stone-200 bg-stone-50 text-stone-700",
  completed: "border-primary/30 bg-primary/10 text-primary",
};

const ACTIVE_STATUSES: InspectionRequestStatus[] = [
  "pending",
  "owner_proposed",
  "scheduled",
];
const HISTORY_STATUSES: InspectionRequestStatus[] = ["completed", "cancelled"];

export function AccountClient({
  slug,
  businessName,
  tab,
}: {
  slug: string;
  businessName: string;
  tab: CustomerAccountTab;
}) {
  return (
    <CustomerBookingShell>
      <Suspense fallback={null}>
        <AccountLegacyQueryRedirect slug={slug} />
      </Suspense>
      <CustomerAuthGate businessName={businessName}>
        <Suspense fallback={null}>
          <CustomerTopNav />
        </Suspense>
      </CustomerAuthGate>

      <CustomerShellPanel>
        <CustomerAuthGate businessName={businessName}>
          <AuthedAccount tab={tab} />
        </CustomerAuthGate>
      </CustomerShellPanel>
    </CustomerBookingShell>
  );
}

/** Redirects old `/account?tab=…` links to path-based URLs. */
function AccountLegacyQueryRedirect({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const legacyTab = parseLegacyAccountTabQuery(params.get("tab"));

  useEffect(() => {
    if (!legacyTab) return;
    router.replace(accountPath(slug, legacyTab));
  }, [router, slug, legacyTab]);

  return null;
}

function AuthedAccount({ tab }: { tab: CustomerAccountTab }) {

  const titles: Record<CustomerAccountTab, string> = {
    profile: "My profile",
    requests: "My requests",
    bookings: "Booking history",
    notifications: "Notifications",
  };

  return (
    <>
      <div>
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
          Customer area
        </p>
        <h1 className="mt-1 font-display text-[22px] font-semibold text-on-surface sm:text-[26px]">
          {titles[tab]}
        </h1>
      </div>

      <div className="mt-5">
        {tab === "profile" ? <ProfileSection /> : null}
        {tab === "requests" ? (
          <BookingsList scope="active" emptyHint="You have no active requests." />
        ) : null}
        {tab === "bookings" ? (
          <BookingsList scope="history" emptyHint="No past bookings yet." />
        ) : null}
        {tab === "notifications" ? <NotificationsSection /> : null}
      </div>
    </>
  );
}

function ProfileSection() {
  const { profile, user, saveProfile } = useCustomerAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.fullName ?? "");
    setPhone(profile?.phone ?? "");
  }, [profile?.fullName, profile?.phone]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await saveProfile({
        fullName: fullName.trim(),
        phone: phone.replace(/\D/g, ""),
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-3 font-body text-[15px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:text-[14px]";
  const labelClass =
    "block font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant";

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 sm:px-5">
        <p className="font-body text-[11px] font-bold uppercase tracking-wider text-primary">
          Signed in as
        </p>
        <p className="mt-0.5 font-body text-[14px] font-semibold text-on-surface">
          {user?.email}
        </p>
        <p className="mt-1 font-body text-[11px] text-on-surface-variant">
          One account, used across every business you book on BMS Pro Trade.
        </p>
      </div>

      <label className="block">
        <span className={labelClass}>Full name</span>
        <input
          type="text"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="e.g. Alex Thompson"
          autoComplete="name"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Mobile number</span>
        <input
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="07XXXXXXXX"
          autoComplete="tel"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Email</span>
        <input
          type="email"
          value={user?.email ?? ""}
          readOnly
          className={`${inputClass} cursor-not-allowed bg-stone-50 text-on-surface-variant`}
        />
        <span className="mt-1 inline-flex items-center gap-1 font-body text-[11px] text-on-surface-variant">
          <span className="material-symbols-outlined text-[14px] text-primary">
            verified
          </span>
          Email is locked to your account.
        </span>
      </label>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-body text-[12px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-body text-[12px] font-semibold text-emerald-700">
          Profile saved.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={saving}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-bold text-on-primary shadow-sm transition-opacity disabled:opacity-60"
      >
        {saving ? (
          <span className="material-symbols-outlined animate-spin text-[16px]">
            progress_activity
          </span>
        ) : (
          <span className="material-symbols-outlined text-[16px]">save</span>
        )}
        Save changes
      </button>
    </form>
  );
}

function useBookings(): {
  bookings: CustomerBooking[];
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const { getIdToken, status } = useCustomerAuth();
  const [bookings, setBookings] = useState<CustomerBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    setError(null);
    try {
      const idToken = await getIdToken();
      if (!idToken) throw new Error("Not signed in");
      const response = await fetch("/api/customer/bookings", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        bookings?: CustomerBooking[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not load bookings.");
      }
      setBookings(payload.bookings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load bookings.");
    } finally {
      setLoading(false);
    }
  }, [getIdToken, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bookings, loading, error, reload: load };
}

function BookingsList({
  scope,
  emptyHint,
}: {
  scope: "active" | "history";
  emptyHint: string;
}) {
  const { bookings, loading, error, reload } = useBookings();

  const filtered = useMemo(() => {
    const allowed = scope === "active" ? ACTIVE_STATUSES : HISTORY_STATUSES;
    return bookings.filter((booking) => allowed.includes(booking.status));
  }, [bookings, scope]);

  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[24px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="font-body text-[13px] font-semibold text-rose-700">
          {error}
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-body text-[12px] font-bold text-rose-700"
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          Try again
        </button>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-variant">
          event_busy
        </span>
        <p className="mt-2 font-body text-[14px] font-semibold text-on-surface">
          {emptyHint}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {filtered.map((booking) => (
        <BookingCard key={booking.id} booking={booking} />
      ))}
    </div>
  );
}

function BookingCard({ booking }: { booking: CustomerBooking }) {
  const slot =
    booking.scheduledSlot ??
    booking.preferredSlots[0] ??
    booking.ownerProposedSlots[0] ??
    null;
  const slotLabel = slot
    ? `${formatSlotDate(slot.date)} · ${TIME_RANGE_SHORT_LABELS[slot.timeRange]}`
    : "Awaiting schedule";

  const headline =
    booking.serviceName ??
    booking.customRequest?.title ??
    (booking.requestType === "custom_quote" ? "Custom request" : "Service request");

  return (
    <article className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            {booking.businessName ?? "Business"}
          </p>
          <p className="mt-0.5 line-clamp-2 font-display text-[15px] font-semibold text-on-surface">
            {headline}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-body text-[11px] font-bold uppercase tracking-wider ${
            STATUS_TONE[booking.status]
          }`}
        >
          {STATUS_LABELS[booking.status]}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-body text-[12px] text-on-surface">
        <span className="inline-flex items-center gap-1">
          <span className="material-symbols-outlined text-[16px] text-primary">
            event
          </span>
          {slotLabel}
        </span>
        {booking.address.suburb || booking.address.state ? (
          <span className="inline-flex items-center gap-1 text-on-surface-variant">
            <span className="material-symbols-outlined text-[16px]">place</span>
            {[booking.address.suburb, booking.address.state]
              .filter(Boolean)
              .join(", ")}
          </span>
        ) : null}
        {booking.bookingSlug ? (
          <Link
            href={`/booknow/${booking.bookingSlug}`}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            Visit business
            <span className="material-symbols-outlined text-[14px]">
              arrow_forward
            </span>
          </Link>
        ) : null}
      </div>

      {booking.ownerProposedSlots.length > 0 &&
      booking.status === "owner_proposed" ? (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2">
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-violet-800">
            Business proposed alternative times
          </p>
          <ul className="mt-1 space-y-0.5 font-body text-[12px] text-violet-900">
            {booking.ownerProposedSlots.map((entry, index) => (
              <li key={`${entry.date}-${entry.timeRange}-${index}`}>
                {formatSlotDate(entry.date)} ·{" "}
                {TIME_RANGE_SHORT_LABELS[entry.timeRange]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {booking.ownerNote ? (
        <p className="mt-2 font-body text-[12px] italic text-on-surface-variant">
          “{booking.ownerNote}”
        </p>
      ) : null}
    </article>
  );
}

function NotificationsSection() {
  const { bookings, loading, error, reload } = useBookings();
  const [lastSeen, setLastSeen] = useState(0);

  useEffect(() => {
    setLastSeen(readLastSeenAt());
  }, []);

  const notifications: CustomerNotification[] = useMemo(
    () => buildCustomerNotifications(bookings),
    [bookings],
  );

  useEffect(() => {
    if (notifications.length === 0) return;
    const top = notifications[0]?.timestamp ?? Date.now();
    writeLastSeenAt(top);
  }, [notifications]);

  if (loading) {
    return (
      <div className="flex min-h-[160px] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[24px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
        <p className="font-body text-[13px] font-semibold text-rose-700">
          {error}
        </p>
        <button
          type="button"
          onClick={reload}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 font-body text-[12px] font-bold text-rose-700"
        >
          <span className="material-symbols-outlined text-[14px]">refresh</span>
          Try again
        </button>
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-6 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-variant">
          notifications_off
        </span>
        <p className="mt-2 font-body text-[14px] font-semibold text-on-surface">
          You&apos;re all caught up.
        </p>
        <p className="mt-1 font-body text-[12px] text-on-surface-variant">
          Updates from the businesses you book will show here.
        </p>
      </div>
    );
  }

  const unread = countUnread(notifications, lastSeen);

  return (
    <div className="space-y-3">
      {unread > 0 ? (
        <p className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 font-body text-[12px] font-semibold text-primary">
          {unread} new {unread === 1 ? "update" : "updates"} since last visit
        </p>
      ) : null}
      <ul className="space-y-2">
        {notifications.map((note) => (
          <li
            key={note.id}
            className="flex gap-3 rounded-2xl border border-stone-200 bg-white p-3 sm:p-4"
          >
            <span className="material-symbols-outlined material-symbols-filled mt-0.5 text-[20px] text-primary">
              {STATUS_ICON_BY_STATUS[note.status]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13px] font-bold text-on-surface">
                {note.title}
              </p>
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                {note.body}
              </p>
              <p className="mt-1 font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                {note.timestamp
                  ? new Date(note.timestamp).toLocaleString()
                  : ""}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATUS_ICON_BY_STATUS: Record<InspectionRequestStatus, string> = {
  pending: "schedule",
  owner_proposed: "edit_calendar",
  scheduled: "event_available",
  cancelled: "event_busy",
  completed: "check_circle",
};
