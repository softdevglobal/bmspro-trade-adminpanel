"use client";

import type { CustomerAccountTab } from "@/components/customer-account-nav";
import { CustomerTopNav } from "@/components/customer-account-nav";
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
  booknowPath,
  parseLegacyAccountTabQuery,
} from "@/lib/customer/booking-routes";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
      <CustomerAccountAccess slug={slug}>
        <CustomerTopNav />
        <CustomerShellPanel>
          <AuthedAccount tab={tab} slug={slug} />
        </CustomerShellPanel>
      </CustomerAccountAccess>
    </CustomerBookingShell>
  );
}

/** Account routes require sign-in; guests are sent back to the public booking page. */
function CustomerAccountAccess({
  slug,
  children,
}: {
  slug: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const { status } = useCustomerAuth();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(booknowPath(slug));
    }
  }, [status, slug, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-[min(50vh,420px)] items-center justify-center">
        <span className="material-symbols-outlined animate-spin text-[28px] text-primary">
          progress_activity
        </span>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return <>{children}</>;
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

function AuthedAccount({
  tab,
  slug,
}: {
  tab: CustomerAccountTab;
  slug: string;
}) {
  const titles: Record<CustomerAccountTab, string> = {
    profile: "My profile",
    requests: "My requests",
    bookings: "Booking history",
    notifications: "Notifications",
  };

  return (
    <>
      {tab !== "profile" ? (
        <div>
          <p className="font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
            Customer area
          </p>
          <h1 className="mt-1 font-display text-[22px] font-semibold text-on-surface sm:text-[26px]">
            {titles[tab]}
          </h1>
        </div>
      ) : null}

      <div className={tab === "profile" ? "" : "mt-5"}>
        {tab === "profile" ? <ProfileSection slug={slug} /> : null}
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

function profileInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function formatMemberSince(ms: number | null | undefined): string | null {
  if (!ms) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

const PROFILE_INPUT_CLASS =
  "w-full rounded-xl border border-stone-200 bg-white py-3 pl-10 pr-3 font-body text-[15px] text-on-surface shadow-sm placeholder:text-on-surface-variant/55 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 sm:text-[14px]";

const PROFILE_LABEL_CLASS =
  "block font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant";

function ProfileField({
  label,
  icon,
  children,
}: {
  label: string;
  icon: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className={PROFILE_LABEL_CLASS}>{label}</span>
      <div className="relative mt-1">
        <span
          className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-stone-400"
          aria-hidden
        >
          {icon}
        </span>
        {children}
      </div>
    </label>
  );
}

function ProfileSection({ slug }: { slug: string }) {
  const { profile, user, saveProfile } = useCustomerAuth();
  const [fullName, setFullName] = useState(profile?.fullName ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const email = user?.email ?? profile?.email ?? "";
  const displayName = fullName.trim() || "Your profile";
  const initials = profileInitials(fullName);
  const memberSince = formatMemberSince(profile?.createdAt);

  const completion = useMemo(() => {
    let score = 0;
    if (fullName.trim().length >= 2) score += 1;
    if (phone.replace(/\D/g, "").length >= 6) score += 1;
    if (email) score += 1;
    return Math.round((score / 3) * 100);
  }, [fullName, phone, email]);

  const registeredName = profile?.registeredBusinessName;
  const registeredSlug = profile?.registeredBookingSlug ?? slug;

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

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-stone-200/90 bg-gradient-to-br from-primary/[0.09] via-white to-[#faf8f5] p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div
          className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-primary/12 blur-2xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-6 left-1/3 h-24 w-24 rounded-full bg-[#ffd0a8]/30 blur-2xl"
          aria-hidden
        />

        <p className="relative font-body text-[11px] font-bold uppercase tracking-wider text-primary/80">
          Customer area
        </p>
        <div className="relative mt-4 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className="flex h-[4.25rem] w-[4.25rem] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-primary to-primary/80 font-display text-[22px] font-bold tracking-tight text-on-primary shadow-lg shadow-primary/25 ring-4 ring-white/80 sm:h-[4.75rem] sm:w-[4.75rem] sm:text-[26px]"
              aria-hidden
            >
              {initials}
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-display text-[22px] font-semibold leading-tight text-on-surface sm:text-[26px]">
                {displayName}
              </h1>
              <p className="mt-0.5 truncate font-body text-[13px] text-on-surface-variant sm:text-[14px]">
                {email}
              </p>
              {memberSince ? (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-stone-200/80 bg-white/70 px-2.5 py-0.5 font-body text-[10px] font-semibold text-on-surface-variant">
                  <span className="material-symbols-outlined text-[13px] text-primary">
                    workspace_premium
                  </span>
                  Member since {memberSince}
                </p>
              ) : null}
            </div>
          </div>

          <div className="w-full shrink-0 rounded-2xl border border-white/80 bg-white/75 px-4 py-3 backdrop-blur-sm sm:max-w-[11rem]">
            <div className="flex items-center justify-between gap-2">
              <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Profile complete
              </p>
              <p className="font-display text-[18px] font-semibold text-primary">
                {completion}%
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200/90">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-[width] duration-500 ease-out"
                style={{ width: `${completion}%` }}
              />
            </div>
            <p className="mt-1.5 font-body text-[10px] leading-snug text-on-surface-variant">
              {completion === 100
                ? "You are all set to book."
                : "Add your name and mobile to book faster."}
            </p>
          </div>
        </div>
      </div>

      {/* Registered business */}
      {registeredName ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-stone-200 bg-[#faf8f5] p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <span className="material-symbols-outlined text-[22px]">storefront</span>
            </span>
            <div className="min-w-0">
              <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
                Registered with
              </p>
              <p className="mt-0.5 font-display text-[17px] font-semibold text-on-surface">
                {registeredName}
              </p>
              <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                Your account was created on this business booking page.
              </p>
            </div>
          </div>
          <Link
            href={booknowPath(registeredSlug)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white px-4 py-2.5 font-body text-[12px] font-bold text-primary shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <span className="material-symbols-outlined text-[16px]">
              calendar_add_on
            </span>
            Book again
          </Link>
        </div>
      ) : null}

      {/* Details card */}
      <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-6">
        <div className="flex items-start gap-3 border-b border-stone-100 pb-4">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-on-surface">
            <span className="material-symbols-outlined text-[20px]">edit_note</span>
          </span>
          <div>
            <h2 className="font-display text-[18px] font-semibold text-on-surface">
              Your details
            </h2>
            <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
              Used when you request visits — one account across all businesses.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ProfileField label="Full name" icon="person">
            <input
              type="text"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="e.g. Alex Thompson"
              autoComplete="name"
              className={PROFILE_INPUT_CLASS}
            />
          </ProfileField>

          <ProfileField label="Mobile number" icon="call">
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="07XXXXXXXX"
              autoComplete="tel"
              className={PROFILE_INPUT_CLASS}
            />
          </ProfileField>

          <div className="sm:col-span-2">
            <ProfileField label="Email" icon="mail">
              <input
                type="email"
                value={email}
                readOnly
                className={`${PROFILE_INPUT_CLASS} cursor-not-allowed bg-stone-50/90 text-on-surface-variant`}
              />
            </ProfileField>
            <p className="mt-1.5 inline-flex items-center gap-1 font-body text-[11px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[14px] text-primary">
                verified_user
              </span>
              Email is locked to your sign-in — contact support to change it.
            </p>
          </div>
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 font-body text-[12px] font-semibold text-rose-700">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 font-body text-[12px] font-semibold text-emerald-800">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            Profile saved successfully.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 border-t border-stone-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-body text-[12px] text-on-surface-variant">
            Changes apply to your next booking request.
          </p>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-body text-[14px] font-bold text-on-primary shadow-md shadow-primary/20 transition-all hover:brightness-105 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {saving ? (
              <span className="material-symbols-outlined animate-spin text-[18px]">
                progress_activity
              </span>
            ) : (
              <span className="material-symbols-outlined text-[18px]">save</span>
            )}
            Save changes
          </button>
        </div>
      </div>
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
