"use client";

import { AuPhoneInput } from "@/components/au-phone-input";
import { AuditLogView } from "@/components/audit-log-view";
import { CustomerSecuritySettings } from "@/components/customer-security-settings";
import { DeleteConfirmModal } from "@/components/delete-confirm-modal";
import type { CustomerAccountTab } from "@/components/customer-account-nav";
import { CustomerTopNav } from "@/components/customer-account-nav";
import { CustomerNotificationBanner } from "@/components/customer-notification-banner";
import { useCustomerAuth } from "@/lib/customer-auth/customer-auth-context";
import { useCustomerNotifications } from "@/lib/notifications/use-customer-notifications";
import {
  NOTIFICATION_STATUS_ICON,
  NOTIFICATION_STATUS_TONE,
} from "@/lib/notifications/types";
import {
  BOOKING_STATUS_LABELS,
  type BookingStatus,
} from "@/lib/bookings/types";
import {
  STATUS_LABELS,
  TIME_RANGE_LABELS,
  formatBudgetAud,
  formatSlotDate,
  formatVisitWindow,
  type InspectionInvoiceSummary,
  type InspectionRequestStatus,
  type InspectionTimeRange,
} from "@/lib/inspection/types";
import type { CustomerBooking } from "@/app/api/customer/jobs/route";
import type { InspectionSlot, InspectionAssignment } from "@/lib/inspection/types";
import {
  CustomerBookingShell,
  CustomerShellPanel,
} from "@/components/customer-booking-shell";
import { QuotationPdfViewerModal } from "@/components/quotation-pdf-viewer-modal";
import Link from "next/link";
import {
  accountBookingFocusPath,
  accountPath,
  booknowPath,
  parseLegacyAccountTabQuery,
} from "@/lib/customer/booking-routes";
import type { NotificationRecord } from "@/lib/notifications/types";
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

const STATUS_TONE: Record<InspectionRequestStatus, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  owner_proposed: "border-violet-200 bg-violet-50 text-violet-800",
  scheduled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  awaiting_decision: "border-orange-200 bg-orange-50 text-orange-800",
  cancelled: "border-stone-200 bg-stone-50 text-stone-700",
  completed: "border-primary/30 bg-primary/10 text-primary",
};

const ACTIVE_STATUSES: InspectionRequestStatus[] = [
  "pending",
  "owner_proposed",
  "scheduled",
  "awaiting_decision",
];
const HISTORY_STATUSES: InspectionRequestStatus[] = ["completed", "cancelled"];

const STATUS_ICON: Record<InspectionRequestStatus, string> = {
  pending: "hourglass_top",
  owner_proposed: "swap_horiz",
  scheduled: "event_available",
  awaiting_decision: "pending_actions",
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

function documentPdfFilename(
  kind: "quotation" | "invoice",
  title: string,
): string {
  const safe = title
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${kind}-${safe || "bmspro"}.pdf`;
}

function customerInvoiceReady(
  invoice: InspectionInvoiceSummary | null | undefined,
): invoice is InspectionInvoiceSummary {
  return Boolean(invoice?.pdfUrl?.trim() && invoice.status === "sent");
}

const JOB_STATUS_TONE: Record<BookingStatus, string> = {
  awaiting: "border-orange-200 bg-orange-50 text-orange-800",
  scheduled: "border-emerald-200 bg-emerald-50 text-emerald-800",
  ongoing: "border-amber-200 bg-amber-50 text-amber-800",
  cancelled: "border-stone-200 bg-stone-100 text-stone-600",
  completed: "border-sky-200 bg-sky-50 text-sky-800",
};

function DocumentPdfActions({
  pdfUrl,
  title,
  kind,
  viewerTitle,
}: {
  pdfUrl: string;
  title: string;
  kind: "quotation" | "invoice";
  viewerTitle?: string;
}) {
  const [viewerOpen, setViewerOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setViewerOpen(true)}
        className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-body text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        <span className="material-symbols-outlined text-[18px]">
          picture_as_pdf
        </span>
        View PDF
      </button>
      <QuotationPdfViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        pdfUrl={pdfUrl}
        title={viewerTitle ?? title}
        downloadFilename={documentPdfFilename(kind, title)}
      />
    </>
  );
}

function QuotationPdfActions({
  pdfUrl,
  title,
}: {
  pdfUrl: string;
  title: string;
}) {
  return (
    <DocumentPdfActions pdfUrl={pdfUrl} title={title} kind="quotation" />
  );
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
        <CustomerNotificationBanner bookingSlug={slug} />
        <CustomerShellPanel>
          <Suspense
            fallback={
              <div className="flex min-h-[160px] items-center justify-center">
                <span className="material-symbols-outlined animate-spin text-[24px] text-primary">
                  progress_activity
                </span>
              </div>
            }
          >
            <AuthedAccount tab={tab} slug={slug} />
          </Suspense>
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
  const searchParams = useSearchParams();
  const focusRequestId =
    tab === "requests" || tab === "jobs"
      ? searchParams.get("request")?.trim() || null
      : null;

  const titles: Record<CustomerAccountTab, string> = {
    profile: "My profile",
    requests: "My requests",
    jobs: "Job history",
    notifications: "Notifications",
    activity: "My activity",
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
          <BookingsList
            scope="active"
            emptyHint="You have no active requests."
            focusRequestId={focusRequestId}
          />
        ) : null}
        {tab === "jobs" ? (
          <BookingsList
            scope="history"
            emptyHint="No past bookings yet."
            focusRequestId={focusRequestId}
          />
        ) : null}
        {tab === "notifications" ? (
          <NotificationsSection slug={slug} />
        ) : null}
        {tab === "activity" ? (
          <ActivitySection slug={slug} />
        ) : null}
      </div>
    </>
  );
}

function ActivitySection({ slug }: { slug: string }) {
  return (
    <div className="rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm sm:p-5">
      <p className="font-body text-[13px] text-on-surface-variant">
        Sign-ins, requests, and account updates for your profile with
        this business.
      </p>
      <div className="mt-4">
        <AuditLogView scope="customer" bookingSlug={slug} />
      </div>
    </div>
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
    <div className="space-y-5">
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
            <AuPhoneInput
              value={phone}
              onChange={setPhone}
              autoComplete="tel"
              size="lg"
              leadingIconPadding="pl-10"
              className="rounded-xl border-stone-200 bg-white shadow-sm focus-within:border-primary/40 focus-within:ring-primary/10"
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

    <CustomerSecuritySettings />
    </div>
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
      const response = await fetch("/api/customer/jobs", {
        headers: { authorization: `Bearer ${idToken}` },
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        jobs?: CustomerBooking[];
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not load jobs.");
      }
      setBookings(payload.jobs ?? []);
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
  focusRequestId = null,
}: {
  scope: "active" | "history";
  emptyHint: string;
  focusRequestId?: string | null;
}) {
  const { bookings, loading, error, reload } = useBookings();

  const filtered = useMemo(() => {
    if (scope === "active") {
      return bookings.filter(
        (booking) =>
          ACTIVE_STATUSES.includes(booking.status) &&
          booking.bookingStatus !== "completed",
      );
    }
    return bookings.filter(
      (booking) =>
        HISTORY_STATUSES.includes(booking.status) ||
        booking.bookingStatus === "completed",
    );
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
        <BookingCard
          key={booking.id}
          booking={booking}
          onChanged={reload}
          focusRequestId={focusRequestId}
        />
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

function ProposedSlotPicker({
  slots,
  selected,
  disabled,
  onSelect,
}: {
  slots: InspectionSlot[];
  selected: InspectionSlot | null;
  disabled: boolean;
  onSelect: (slot: InspectionSlot) => void;
}) {
  return (
    <ul className="mt-1.5 space-y-2">
      {slots.map((slot, index) => {
        const checked =
          selected?.date === slot.date && selected.timeRange === slot.timeRange;
        return (
          <li key={`${slot.date}-${slot.timeRange}-${index}`}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(slot)}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left shadow-sm transition-colors ${
                checked
                  ? "border-emerald-400 bg-emerald-50 ring-1 ring-emerald-300"
                  : "border-violet-200/90 bg-violet-50/70 hover:border-emerald-300"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 font-body text-[13px] font-semibold leading-snug text-on-surface">
                  <span className="material-symbols-outlined text-[17px] text-primary">
                    event
                  </span>
                  {formatSlotDate(slot.date)}
                </span>
                <span className="mt-1 flex items-center gap-1.5 font-body text-[12px] leading-snug text-violet-900">
                  <span className="material-symbols-outlined text-[16px] text-primary/85">
                    {slotTimeIcon(slot.timeRange)}
                  </span>
                  {TIME_RANGE_LABELS[slot.timeRange]}
                </span>
              </span>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  checked
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-stone-300 bg-white text-transparent"
                }`}
              >
                {checked ? (
                  <span className="material-symbols-outlined text-[14px]">
                    check
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function inspectorAvatarUrl(assigned: InspectionAssignment): string {
  const seed = encodeURIComponent(
    assigned.uid || assigned.email || assigned.name,
  );
  return `https://api.dicebear.com/9.x/notionists/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

function assigneeRoleLabel(assigned: InspectionAssignment): string {
  return assigned.type === "owner" ? "Business owner" : "Team member";
}

function AssigneeHighlight({
  assignedTo,
  label,
  tone = "emerald",
}: {
  assignedTo: InspectionAssignment;
  label: string;
  tone?: "emerald" | "sky";
}) {
  const styles =
    tone === "sky"
      ? {
          wrap: "border-sky-200/80 bg-white/90",
          label: "text-sky-700/90",
          ring: "ring-sky-100",
        }
      : {
          wrap: "border-emerald-200/80 bg-white/90",
          label: "text-emerald-700/90",
          ring: "ring-emerald-100",
        };

  return (
    <div
      className={`mt-3 flex items-center gap-3 rounded-xl border px-3 py-3 shadow-sm ${styles.wrap}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={inspectorAvatarUrl(assignedTo)}
        alt=""
        className={`h-12 w-12 shrink-0 rounded-full border-2 border-white object-cover shadow-sm ring-2 ${styles.ring}`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`font-body text-[10px] font-bold uppercase tracking-wider ${styles.label}`}
        >
          {label}
        </p>
        <p className="mt-0.5 font-body text-[15px] font-bold text-on-surface">
          {assignedTo.name}
        </p>
        <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
          {assigneeRoleLabel(assignedTo)}
          {assignedTo.email ? ` · ${assignedTo.email}` : ""}
        </p>
      </div>
    </div>
  );
}

function ConfirmedVisitHighlight({
  slot,
  assignedTo,
  startTime,
  endTime,
}: {
  slot: InspectionSlot;
  assignedTo: InspectionAssignment | null;
  startTime: string | null;
  endTime: string | null;
}) {
  const visitWindow = formatVisitWindow(startTime, endTime);
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-emerald-300/90 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/40 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.35)] ring-1 ring-emerald-200/80">
      <div className="border-b border-emerald-200/70 bg-emerald-600/10 px-4 py-2.5">
        <p className="inline-flex items-center gap-2 font-body text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          <span className="material-symbols-outlined material-symbols-filled text-[18px] text-emerald-600">
            event_available
          </span>
          Your visit is confirmed
        </p>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200">
            <span className="material-symbols-outlined material-symbols-filled text-[22px]">
              calendar_month
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] font-semibold leading-snug text-emerald-950">
              {formatSlotDate(slot.date)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 font-body text-[13px] font-semibold text-emerald-800">
              <span className="material-symbols-outlined text-[17px]">
                {slotTimeIcon(slot.timeRange)}
              </span>
              {TIME_RANGE_LABELS[slot.timeRange]}
            </p>
            {visitWindow ? (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/10 px-2.5 py-1 font-body text-[13px] font-bold text-emerald-900 ring-1 ring-emerald-200/80">
                <span className="material-symbols-outlined text-[17px] text-emerald-700">
                  schedule
                </span>
                Arrival window: {visitWindow}
              </p>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-emerald-300 bg-white/70 px-2.5 py-1 font-body text-[12px] font-semibold text-emerald-800/90">
                <span className="material-symbols-outlined text-[16px]">
                  hourglass_top
                </span>
                Exact time to be confirmed by the business
              </p>
            )}
          </div>
        </div>

        {assignedTo ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-200/80 bg-white/90 px-3 py-3 shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={inspectorAvatarUrl(assignedTo)}
              alt=""
              className="h-12 w-12 shrink-0 rounded-full border-2 border-white object-cover shadow-sm ring-2 ring-emerald-100"
            />
            <div className="min-w-0 flex-1">
              <p className="font-body text-[10px] font-bold uppercase tracking-wider text-emerald-700/90">
                Who will visit
              </p>
              <p className="mt-0.5 font-body text-[15px] font-bold text-on-surface">
                {assignedTo.name}
              </p>
              <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                {assignedTo.type === "owner"
                  ? "Business owner"
                  : "Assigned inspector"}
                {assignedTo.email ? ` · ${assignedTo.email}` : ""}
              </p>
            </div>
            <span className="material-symbols-outlined shrink-0 text-[22px] text-emerald-600/80">
              engineering
            </span>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-emerald-200 bg-white/60 px-3 py-2.5 font-body text-[12px] text-emerald-800/80">
            <span className="material-symbols-outlined mr-1 align-middle text-[16px]">
              info
            </span>
            An inspector will be assigned before your visit.
          </p>
        )}
      </div>
    </section>
  );
}

function BookingCard({
  booking,
  onChanged,
  focusRequestId = null,
}: {
  booking: CustomerBooking;
  onChanged: () => void;
  focusRequestId?: string | null;
}) {
  const { getIdToken } = useCustomerAuth();
  const cardRef = useRef<HTMLElement | null>(null);
  const isFocused = Boolean(focusRequestId && focusRequestId === booking.id);
  const [expanded, setExpanded] = useState(isFocused);
  const [selectedProposed, setSelectedProposed] = useState<InspectionSlot | null>(
    null,
  );
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"accepted" | "rejected" | null>(
    null,
  );
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isFocused) return;
    setExpanded(true);
    const frame = requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [isFocused, booking.id]);

  async function acceptProposed() {
    if (!selectedProposed) {
      setAcceptError("Choose one of the proposed times first.");
      return;
    }
    setAccepting(true);
    setAcceptError(null);
    try {
      const idToken = await getIdToken();
      const response = await fetch(`/api/customer/jobs/${booking.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          action: "accept_proposed",
          slot: selectedProposed,
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not accept this time.");
      }
      setSelectedProposed(null);
      onChanged();
    } catch (err) {
      setAcceptError(
        err instanceof Error ? err.message : "Could not accept this time.",
      );
    } finally {
      setAccepting(false);
    }
  }

  async function decideQuotation(decision: "accepted" | "rejected") {
    setDeciding(decision);
    setDecisionError(null);
    try {
      const idToken = await getIdToken();
      const response = await fetch(`/api/customer/jobs/${booking.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ action: "quotation_decision", decision }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Could not save your decision.");
      }
      onChanged();
    } catch (err) {
      setDecisionError(
        err instanceof Error ? err.message : "Could not save your decision.",
      );
    } finally {
      setDeciding(null);
    }
  }

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
  const invoiceReady = customerInvoiceReady(booking.invoice);
  const jobStatus = booking.bookingStatus;
  const jobAssignee = booking.jobAssignedTo ?? booking.assignedTo;

  return (
    <article
      ref={cardRef}
      className={`overflow-hidden rounded-2xl border bg-white shadow-[0_8px_28px_-18px_rgba(0,74,198,0.12)] ring-1 ${
        isFocused
          ? "border-primary/50 ring-2 ring-primary/25"
          : "border-stone-200/90 ring-stone-100"
      }`}
    >
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

        {booking.scheduledSlot && !expanded ? (
          <div className="mt-3 rounded-xl border border-emerald-200/80 bg-emerald-50/60 px-3 py-2.5">
            <p className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-body text-[12px] font-semibold text-emerald-900">
              <span className="material-symbols-outlined text-[16px] text-emerald-600">
                event_available
              </span>
              Visit confirmed · {formatSlotDate(booking.scheduledSlot.date)} ·{" "}
              {TIME_RANGE_LABELS[booking.scheduledSlot.timeRange]}
            </p>
            <p className="mt-1 font-body text-[11px] text-emerald-800/85">
              Open details for your arrival time
            </p>
          </div>
        ) : null}

        {invoiceReady && !expanded ? (
          <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50/70 px-3 py-2.5">
            <p className="inline-flex items-center gap-1.5 font-body text-[12px] font-semibold text-sky-800">
              <span className="material-symbols-outlined text-[16px]">
                receipt_long
              </span>
              Invoice ready — expand to view or download
            </p>
          </div>
        ) : null}

        {jobStatus === "completed" && !invoiceReady && !expanded ? (
          <div className="mt-3 rounded-xl border border-sky-200/80 bg-sky-50/60 px-3 py-2.5">
            <p className="inline-flex items-center gap-1.5 font-body text-[12px] font-semibold text-sky-800">
              <span className="material-symbols-outlined text-[16px]">
                check_circle
              </span>
              Job completed
            </p>
          </div>
        ) : null}

        {booking.quotation?.pdfUrl && !expanded ? (
          <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2.5">
            <p className="inline-flex items-center gap-1.5 font-body text-[12px] font-semibold text-primary">
              <span className="material-symbols-outlined text-[16px]">
                picture_as_pdf
              </span>
              Quotation ready — expand to view or download
            </p>
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
          {invoiceReady ? (
            <section className="rounded-xl border border-sky-200/80 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                  <span className="material-symbols-outlined text-[22px]">
                    receipt_long
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wider text-sky-800">
                    Your invoice
                  </p>
                  {booking.invoice?.invoiceCode ? (
                    <p className="mt-0.5 font-mono text-[12px] font-semibold text-sky-800">
                      {booking.invoice.invoiceCode}
                    </p>
                  ) : null}
                  {formatBudgetAud(booking.invoice?.finalPriceAud) ? (
                    <p className="mt-1 font-display text-[20px] font-semibold text-on-surface">
                      {formatBudgetAud(booking.invoice?.finalPriceAud)}
                    </p>
                  ) : null}
                  {formatBudgetAud(booking.invoice?.balanceDueAud) &&
                  booking.invoice?.balanceDueAud !==
                    booking.invoice?.finalPriceAud ? (
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      Balance due {formatBudgetAud(booking.invoice?.balanceDueAud)}
                    </p>
                  ) : null}
                  {booking.invoice?.dueDate ? (
                    <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                      Due {formatSlotDate(booking.invoice.dueDate)}
                    </p>
                  ) : null}
                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                    View or download the invoice PDF for this job.
                  </p>
                  <DocumentPdfActions
                    pdfUrl={booking.invoice!.pdfUrl!}
                    title={headline}
                    kind="invoice"
                    viewerTitle={
                      booking.invoice?.invoiceCode
                        ? `Invoice ${booking.invoice.invoiceCode}`
                        : "Invoice PDF"
                    }
                  />
                  <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 font-body text-[12px] font-bold text-sky-800">
                    <span className="material-symbols-outlined text-[16px]">
                      mark_email_read
                    </span>
                    Invoice sent to your email
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          {booking.bookingId && jobStatus ? (
            <section className="rounded-xl border border-sky-200/80 bg-sky-50/50 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                  <span className="material-symbols-outlined text-[22px]">
                    handyman
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wider text-sky-800">
                    Your job
                  </p>
                  <p className="mt-1 font-display text-[18px] font-semibold text-on-surface">
                    {BOOKING_STATUS_LABELS[jobStatus]}
                  </p>
                  {booking.bookingCode ? (
                    <p className="mt-0.5 font-mono text-[12px] font-semibold text-sky-800">
                      {booking.bookingCode}
                    </p>
                  ) : null}
                  {jobStatus === "completed" ? (
                    <p className="mt-1 font-body text-[12px] text-on-surface-variant">
                      The work for this visit has been marked complete.
                    </p>
                  ) : null}
                  {jobAssignee ? (
                    <AssigneeHighlight
                      assignedTo={jobAssignee}
                      label={
                        jobStatus === "completed"
                          ? "Who completed the job"
                          : "Assigned to"
                      }
                      tone="sky"
                    />
                  ) : null}
                </div>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 font-body text-[10px] font-bold uppercase tracking-wider ${JOB_STATUS_TONE[jobStatus]}`}
                >
                  {BOOKING_STATUS_LABELS[jobStatus]}
                </span>
              </div>
            </section>
          ) : null}

          {booking.scheduledSlot ? (
            <ConfirmedVisitHighlight
              slot={booking.scheduledSlot}
              assignedTo={booking.assignedTo}
              startTime={booking.scheduledStartTime}
              endTime={booking.scheduledEndTime}
            />
          ) : null}

          {booking.quotation?.pdfUrl ? (
            <section className="rounded-xl border border-primary/20 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <span className="material-symbols-outlined text-[22px]">
                    picture_as_pdf
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-body text-[10px] font-bold uppercase tracking-wider text-primary">
                    Your quotation
                  </p>
                  {formatBudgetAud(booking.quotation.finalPriceAud) ? (
                    <p className="mt-1 font-display text-[20px] font-semibold text-on-surface">
                      {formatBudgetAud(booking.quotation.finalPriceAud)}
                    </p>
                  ) : null}
                  <p className="mt-0.5 font-body text-[12px] text-on-surface-variant">
                    View or download the full quotation PDF from your visit.
                  </p>
                  <QuotationPdfActions
                    pdfUrl={booking.quotation.pdfUrl}
                    title={headline}
                  />

                  {booking.quotation.customerDecision === "accepted" ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-body text-[12px] font-bold text-emerald-700">
                      <span className="material-symbols-outlined text-[16px]">
                        check_circle
                      </span>
                      You accepted this quotation
                    </p>
                  ) : booking.quotation.customerDecision === "rejected" ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 font-body text-[12px] font-bold text-rose-700">
                      <span className="material-symbols-outlined text-[16px]">
                        cancel
                      </span>
                      You rejected this quotation
                    </p>
                  ) : !booking.bookingId &&
                    booking.quotation.status !== "draft" ? (
                    <div className="mt-3 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3">
                      <p className="font-body text-[12px] font-bold text-amber-900">
                        Do you accept this quotation?
                      </p>
                      <p className="mt-0.5 font-body text-[11px] text-amber-800/90">
                        The business can only schedule the job once you accept.
                      </p>
                      {decisionError ? (
                        <p className="mt-2 font-body text-[12px] font-semibold text-rose-600">
                          {decisionError}
                        </p>
                      ) : null}
                      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => void decideQuotation("accepted")}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 font-body text-[13px] font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            className={`material-symbols-outlined text-[18px] ${
                              deciding === "accepted" ? "animate-spin" : ""
                            }`}
                          >
                            {deciding === "accepted"
                              ? "progress_activity"
                              : "check_circle"}
                          </span>
                          {deciding === "accepted"
                            ? "Accepting…"
                            : "Accept quotation"}
                        </button>
                        <button
                          type="button"
                          disabled={deciding !== null}
                          onClick={() => void decideQuotation("rejected")}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white py-2.5 font-body text-[13px] font-bold text-rose-600 shadow-sm transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            className={`material-symbols-outlined text-[18px] ${
                              deciding === "rejected" ? "animate-spin" : ""
                            }`}
                          >
                            {deciding === "rejected"
                              ? "progress_activity"
                              : "cancel"}
                          </span>
                          {deciding === "rejected"
                            ? "Rejecting…"
                            : "Reject quotation"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

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

          {booking.ownerProposedSlots.length > 0 ? (
            booking.status === "owner_proposed" ? (
              <BookingDetailRow
                icon="swap_horiz"
                label="Business proposed times — pick one"
              >
                <ProposedSlotPicker
                  slots={booking.ownerProposedSlots}
                  disabled={accepting}
                  selected={selectedProposed}
                  onSelect={setSelectedProposed}
                />
                {acceptError ? (
                  <p className="mt-2 font-body text-[12px] font-semibold text-rose-600">
                    {acceptError}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={accepting || !selectedProposed}
                  onClick={() => void acceptProposed()}
                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 font-body text-[13px] font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {accepting ? "progress_activity" : "event_available"}
                  </span>
                  {accepting ? "Confirming…" : "Accept this time"}
                </button>
                <p className="mt-2 font-body text-[11px] text-on-surface-variant">
                  The business will confirm the exact arrival time after you
                  accept.
                </p>
              </BookingDetailRow>
            ) : (
              <BookingDetailRow icon="swap_horiz" label="Business proposed times">
                <BookingSlotsList
                  slots={booking.ownerProposedSlots}
                  variant="proposed"
                />
              </BookingDetailRow>
            )
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

function NotificationsSection({ slug }: { slug: string }) {
  const router = useRouter();
  const { notifications, loading, error, unread, reload, markAllRead, clearOne, clearAll } =
    useCustomerNotifications();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);

  function openRequest(note: NotificationRecord) {
    if (!note.requestId) return;
    const scope =
      note.status === "completed" || note.status === "cancelled"
        ? "history"
        : "active";
    router.push(accountBookingFocusPath(slug, note.requestId, scope));
  }

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

  async function handleClearAll() {
    setClearingAll(true);
    try {
      await clearAll();
      setShowClearConfirm(false);
    } finally {
      setClearingAll(false);
    }
  }

  return (
    <div className="space-y-3">
      <DeleteConfirmModal
        open={showClearConfirm}
        title="Clear all notifications?"
        description="This will permanently remove all updates from your notification list. You can still view your requests from the Requests and History tabs."
        confirmLabel="Yes, clear all"
        cancelLabel="Cancel"
        isLoading={clearingAll}
        onCancel={() => {
          if (!clearingAll) setShowClearConfirm(false);
        }}
        onConfirm={() => void handleClearAll()}
      />

      <div className="flex items-center justify-between gap-2">
        <p className="font-body text-[12px] text-on-surface-variant">
          {unread > 0
            ? `${unread} unread ${unread === 1 ? "update" : "updates"}`
            : `${notifications.length} ${notifications.length === 1 ? "update" : "updates"}`}
        </p>
        <button
          type="button"
          onClick={() => setShowClearConfirm(true)}
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
            className={`group flex items-stretch gap-1 rounded-2xl border sm:gap-0 ${
              note.read
                ? "border-stone-200 bg-white"
                : "border-primary/30 bg-primary/[0.04]"
            }`}
          >
            <button
              type="button"
              onClick={() => openRequest(note)}
              className="flex min-w-0 flex-1 gap-3 rounded-2xl p-3 text-left transition-colors hover:bg-stone-50/80 sm:p-4"
            >
              <span
                className={`material-symbols-outlined material-symbols-filled mt-0.5 shrink-0 text-[20px] ${NOTIFICATION_STATUS_TONE[note.status]}`}
              >
                {NOTIFICATION_STATUS_ICON[note.status]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-body text-[13px] font-bold text-on-surface">
                  {note.title}
                </span>
                <span className="mt-1 block font-body text-[12px] text-on-surface-variant">
                  {note.body}
                </span>
                <span className="mt-1 block font-body text-[10px] uppercase tracking-wide text-on-surface-variant">
                  {note.createdAt
                    ? new Date(note.createdAt).toLocaleString()
                    : ""}
                </span>
                <span className="mt-2 inline-flex items-center gap-0.5 font-body text-[11px] font-semibold text-primary">
                  Open request
                  <span className="material-symbols-outlined text-[14px]">
                    arrow_forward
                  </span>
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void clearOne(note.id);
              }}
              aria-label="Clear notification"
              className="m-2 flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-full text-on-surface-variant transition-colors hover:bg-stone-100 hover:text-rose-600 sm:m-3"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
