"use client";

import type { CustomerAccountTab } from "@/components/customer-account-nav";
import { CustomerTopNav } from "@/components/customer-account-nav";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import { useCustomerNotifications } from "@/lib/notifications/use-customer-notifications";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
} from "@/lib/notifications/types";
import {
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  formatBudgetAud,
  formatSlotDate,
  type InspectionRequestStatus,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import type { CustomerBooking } from "@/app/api/customer/bookings/route";
import type { InspectionSlot } from "@/lib/inspection/types";
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

const STATUS_ICON: Record<InspectionRequestStatus, string> = {
  pending: "hourglass_top",
  owner_proposed: "swap_horiz",
  scheduled: "event_available",
  cancelled: "cancel",
  completed: "check_circle",
};

function formatFullAddress(booking: CustomerBooking): string {
  const { street, suburb, state, postcode } = booking.address;
  return [street, suburb, state, postcode].filter(Boolean).join(", ");
}

function formatCreatedAt(ms: number | null): string | null {
  if (!ms) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ms));
  } catch {
    return null;
  }
}

function slotTimeIcon(timeRange: InspectionTimeRange): string {
  return timeRange === "morning" ? "wb_twilight" : "wb_sunny";
}

function requestTypeLabel(booking: CustomerBooking): string {
  if (booking.requestType === "custom_quote") return "Custom quote";
  return "Existing service";
}

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
      <div className="rounded-2xl border border-dashed border-stone-200/90 bg-gradient-to-br from-white to-[#faf8f5] p-8 text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <span className="material-symbols-outlined text-[30px]">inbox</span>
        </span>
        <p className="mt-3 font-display text-[17px] font-semibold text-on-surface">
          {emptyHint}
        </p>
        <p className="mt-1 font-body text-[13px] text-on-surface-variant">
          New requests will show up here with full visit details.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {filtered.map((booking) => (
        <BookingCard key={booking.id} booking={booking} />
      ))}
    </div>
  );
}

function BookingDetailRow({
  icon,
  label,
  value,
  children,
}: {
  icon: string;
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-primary ring-1 ring-stone-200/80">
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-body text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
          {label}
        </p>
        {children ?? (
          <p className="mt-0.5 font-body text-[13px] leading-snug text-on-surface">
            {value}
          </p>
        )}
      </div>
    </div>
  );
}

function BookingSlotsList({
  slots,
  variant = "default",
}: {
  slots: InspectionSlot[];
  variant?: "default" | "proposed" | "confirmed";
}) {
  if (slots.length === 0) {
    return (
      <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">—</p>
    );
  }

  const cardClass =
    variant === "proposed"
      ? "border-violet-200/90 bg-violet-50/70"
      : variant === "confirmed"
        ? "border-emerald-200/90 bg-emerald-50/60"
        : "border-stone-200/80 bg-white";

  const timeClass =
    variant === "proposed"
      ? "text-violet-900"
      : variant === "confirmed"
        ? "text-emerald-900"
        : "text-on-surface-variant";

  return (
    <ul className="mt-1.5 space-y-2">
      {slots.map((slot, index) => (
        <li
          key={`${slot.date}-${slot.timeRange}-${index}`}
          className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 shadow-sm ${cardClass}`}
        >
          {slots.length > 1 ? (
            <span
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 font-body text-[11px] font-bold text-primary"
              aria-hidden
            >
              {index + 1}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 font-body text-[13px] font-semibold leading-snug text-on-surface">
              <span className="material-symbols-outlined text-[17px] text-primary">
                event
              </span>
              {formatSlotDate(slot.date)}
            </p>
            <p
              className={`mt-1 flex items-center gap-1.5 font-body text-[12px] leading-snug ${timeClass}`}
            >
              <span className="material-symbols-outlined text-[16px] text-primary/85">
                {slotTimeIcon(slot.timeRange)}
              </span>
              {TIME_RANGE_LABELS[slot.timeRange]}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function BookingCard({ booking }: { booking: CustomerBooking }) {
  const [expanded, setExpanded] = useState(false);

  const headline =
    booking.serviceName ??
    booking.customRequest?.title ??
    (booking.requestType === "custom_quote" ? "Custom request" : "Service request");

  const serviceIcon =
    booking.requestType === "custom_quote" ? "request_quote" : "home_repair_service";
  const fullAddress = formatFullAddress(booking);
  const submittedAt = formatCreatedAt(booking.createdAt);
  const locationShort = [booking.address.suburb, booking.address.state]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-[0_8px_28px_-18px_rgba(0,74,198,0.12)] ring-1 ring-stone-100">
      <div className="border-l-4 border-l-primary bg-gradient-to-r from-primary/[0.06] via-white to-white p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <span className="material-symbols-outlined text-[22px]">{serviceIcon}</span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-body text-[10px] font-bold uppercase tracking-wider text-primary/80">
              {booking.businessName ?? "Business"}
            </p>
            <p className="mt-0.5 font-display text-[17px] font-semibold leading-snug text-on-surface sm:text-[18px]">
              {headline}
            </p>
            {booking.serviceBusinessType ? (
              <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                {booking.serviceBusinessType}
              </p>
            ) : null}
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wider ${
              STATUS_TONE[booking.status]
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">
              {STATUS_ICON[booking.status]}
            </span>
            <span className="hidden sm:inline">{STATUS_LABELS[booking.status]}</span>
            <span className="sm:hidden">
              {STATUS_LABELS[booking.status].split(" ")[0]}
            </span>
          </span>
        </div>

        {locationShort ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-white/80 px-2.5 py-1 font-body text-[12px] text-on-surface-variant">
              <span className="material-symbols-outlined text-[16px] text-primary/80">
                place
              </span>
              {locationShort}
            </span>
          </div>
        ) : null}

        {booking.status === "owner_proposed" &&
        booking.ownerProposedSlots.length > 0 &&
        !expanded ? (
          <p className="mt-2.5 inline-flex items-center gap-1 font-body text-[12px] font-semibold text-violet-700">
            <span className="material-symbols-outlined text-[16px]">info</span>
            New times proposed — expand for details
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-center gap-1.5 border-t border-stone-200/80 bg-[#faf8f5] py-2.5 font-body text-[12px] font-bold text-primary transition-colors hover:bg-primary/5"
      >
        {expanded ? "Hide details" : "View all details"}
        <span
          className={`material-symbols-outlined text-[20px] transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        >
          expand_more
        </span>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-stone-200/80 bg-[#faf8f5] px-4 py-4 sm:px-5">
          <BookingDetailRow
            icon="category"
            label="Request type"
            value={requestTypeLabel(booking)}
          />

          {booking.customRequest?.description ? (
            <BookingDetailRow icon="description" label="Job description">
              <p className="mt-0.5 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-on-surface">
                {booking.customRequest.description}
              </p>
            </BookingDetailRow>
          ) : null}

          {booking.customerNotes ? (
            <BookingDetailRow icon="sticky_note_2" label="Your notes">
              <p className="mt-0.5 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-on-surface">
                {booking.customerNotes}
              </p>
            </BookingDetailRow>
          ) : null}

          {formatBudgetAud(booking.budgetAud) ? (
            <BookingDetailRow
              icon="payments"
              label="Your budget"
              value={formatBudgetAud(booking.budgetAud) ?? undefined}
            />
          ) : null}

          <BookingDetailRow
            icon="place"
            label="Visit address"
            value={fullAddress || "—"}
          />

          <BookingDetailRow icon="calendar_month" label="Your preferred times">
            <BookingSlotsList slots={booking.preferredSlots} />
          </BookingDetailRow>

          {booking.scheduledSlot ? (
            <BookingDetailRow icon="event_available" label="Confirmed visit">
              <BookingSlotsList
                slots={[booking.scheduledSlot]}
                variant="confirmed"
              />
            </BookingDetailRow>
          ) : null}

          {booking.ownerProposedSlots.length > 0 ? (
            <BookingDetailRow icon="swap_horiz" label="Business proposed times">
              <BookingSlotsList
                slots={booking.ownerProposedSlots}
                variant="proposed"
              />
            </BookingDetailRow>
          ) : null}

          {booking.assignedTo ? (
            <BookingDetailRow
              icon="engineering"
              label="Assigned to"
              value={booking.assignedTo.name}
            />
          ) : null}

          {booking.ownerNote ? (
            <BookingDetailRow icon="chat" label="Message from business">
              <p className="mt-0.5 font-body text-[13px] italic leading-relaxed text-on-surface">
                “{booking.ownerNote}”
              </p>
            </BookingDetailRow>
          ) : null}

          {submittedAt ? (
            <BookingDetailRow
              icon="schedule"
              label="Submitted"
              value={submittedAt}
            />
          ) : null}

          {booking.bookingSlug ? (
            <div className="pt-1">
              <Link
                href={booknowPath(booking.bookingSlug)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/25 bg-white py-2.5 font-body text-[13px] font-bold text-primary shadow-sm transition-colors hover:bg-primary/5 sm:w-auto sm:px-5"
              >
                <span className="material-symbols-outlined text-[18px]">
                  storefront
                </span>
                Visit {booking.businessName ?? "business"}
                <span className="material-symbols-outlined text-[16px]">
                  arrow_forward
                </span>
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function NotificationsSection() {
  const { notifications, loading, error, unread, reload, markAllRead, clearOne, clearAll } =
    useCustomerNotifications();

  useEffect(() => {
    if (notifications.length === 0) return;
    void markAllRead();
    // Run once per fresh load of notifications.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length]);

  if (loading && notifications.length === 0) {
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
          onClick={() => void reload()}
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-body text-[12px] text-on-surface-variant">
          {unread > 0
            ? `${unread} unread ${unread === 1 ? "update" : "updates"}`
            : `${notifications.length} ${notifications.length === 1 ? "update" : "updates"}`}
        </p>
        <button
          type="button"
          onClick={() => void clearAll()}
          className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 font-body text-[12px] font-semibold text-on-surface-variant transition-colors hover:border-rose-200 hover:text-rose-600"
        >
          <span className="material-symbols-outlined text-[15px]">clear_all</span>
          Clear all
        </button>
      </div>
      <ul className="space-y-2">
        {notifications.map((note) => (
          <li
            key={note.id}
            className={`group flex gap-3 rounded-2xl border p-3 sm:p-4 ${
              note.read
                ? "border-stone-200 bg-white"
                : "border-primary/30 bg-primary/[0.04]"
            }`}
          >
            <span
              className={`material-symbols-outlined material-symbols-filled mt-0.5 text-[20px] ${NOTIFICATION_STATUS_TONE[note.status]}`}
            >
              {NOTIFICATION_STATUS_ICON[note.status]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-body text-[13px] font-bold text-on-surface">
                {note.title}
              </p>
              <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                {note.body}
              </p>
              <p className="mt-1 font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                {note.createdAt
                  ? new Date(note.createdAt).toLocaleString()
                  : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void clearOne(note.id)}
              aria-label="Clear notification"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-stone-100 hover:text-rose-600"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
