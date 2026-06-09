"use client";

import { BookingLinkCard } from "@/components/booking-link-card";
import { BusinessGstSettings } from "@/components/business-gst-settings";
import { BusinessLogoSettings } from "@/components/business-logo-settings";
import { BusinessProfileSettings } from "@/components/business-profile-settings";
import { BusinessProfileSummaryCard } from "@/components/business-profile-summary-card";
import { BusinessSecuritySettings } from "@/components/business-security-settings";
import { BusinessTermsSettings } from "@/components/business-terms-settings";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import type { BusinessProfilePlan } from "@/lib/onboarding/server";
import { useEffect, useMemo, useState } from "react";

// const QUICK_LINKS = [
//   {
//     href: "/dashboard/services",
//     title: "Services",
//     description: "Inspection services, checklists, and durations.",
//     icon: "handyman",
//     iconClass: "bg-secondary/10 text-secondary",
//   },
//   {
//     href: "/dashboard/items",
//     title: "Item list",
//     description: "Price catalog used on quotations.",
//     icon: "inventory_2",
//     iconClass: "bg-primary/10 text-primary",
//   },
//   {
//     href: "/dashboard/team",
//     title: "Team",
//     description: "Staff accounts, roles, and availability.",
//     icon: "groups",
//     iconClass: "bg-primary/10 text-primary",
//   },
//   {
//     href: "/dashboard/calendar",
//     title: "Calendar",
//     description: "Scheduled visits and job bookings.",
//     icon: "calendar_month",
//     iconClass: "bg-tertiary/10 text-tertiary",
//   },
//   {
//     href: "/dashboard/customers",
//     title: "Customers",
//     description: "Customer records from inspections and sign-ups.",
//     icon: "group",
//     iconClass: "bg-tertiary/10 text-tertiary",
//   },
//   {
//     href: "/dashboard/quotations",
//     title: "Quotations",
//     description: "Create, send, and track customer quotes.",
//     icon: "request_quote",
//     iconClass: "bg-secondary/10 text-secondary",
//   },
// ] as const;

export type ProfileFormState = {
  businessName: string;
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  abn: string;
};

type ProfileMeta = {
  businessType: string | null;
  state: string | null;
  timezone: string | null;
  plan: BusinessProfilePlan | null;
  logoUrl: string | null;
};

export function BusinessSettingsPanel() {
  const { user } = useAuth();
  const liveProfile = useBusinessProfile();
  const [metaLoading, setMetaLoading] = useState(true);
  const [meta, setMeta] = useState<ProfileMeta>({
    businessType: null,
    state: null,
    timezone: null,
    plan: null,
    logoUrl: null,
  });
  const [form, setForm] = useState<ProfileFormState>({
    businessName: "",
    businessAddress: "",
    businessEmail: "",
    businessPhone: "",
    abn: "",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      if (!user) {
        setMetaLoading(false);
        return;
      }

      setMetaLoading(true);
      try {
        const token = await user.getIdToken();
        const response = await fetch("/api/business/profile", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const payload = (await response.json()) as {
          ok?: boolean;
          profile?: {
            businessName?: string | null;
            businessAddress?: string | null;
            businessEmail?: string | null;
            businessPhone?: string | null;
            abn?: string | null;
            businessType?: string | null;
            state?: string | null;
            timezone?: string | null;
            plan?: BusinessProfilePlan | null;
            logoUrl?: string | null;
          };
        };
        if (!response.ok || !payload.ok || !payload.profile || !active) return;

        const p = payload.profile;
        setForm({
          businessName: p.businessName ?? "",
          businessAddress: p.businessAddress ?? "",
          businessEmail: p.businessEmail ?? "",
          businessPhone: p.businessPhone ?? "",
          abn: p.abn ?? "",
        });
        setMeta({
          businessType: p.businessType ?? null,
          state: p.state ?? null,
          timezone: p.timezone ?? null,
          plan: p.plan ?? null,
          logoUrl: p.logoUrl ?? null,
        });
      } catch {
        /* keep defaults */
      } finally {
        if (active) setMetaLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const summaryData = useMemo(
    () => ({
      businessName: form.businessName,
      businessEmail: user?.email?.trim() || form.businessEmail,
      logoUrl: liveProfile?.logoUrl ?? meta.logoUrl,
      abn: form.abn,
      businessPhone: form.businessPhone,
      businessAddress: form.businessAddress,
      businessType: meta.businessType,
      state: meta.state,
      timezone: meta.timezone,
      plan: meta.plan,
    }),
    [form, user?.email, liveProfile?.logoUrl, meta],
  );

  function handleProfileSaved(next: ProfileFormState) {
    setForm(next);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <aside className="order-1 flex min-w-0 flex-col gap-8 lg:sticky lg:top-24 lg:order-2 lg:self-start">
        <BusinessProfileSummaryCard data={summaryData} loading={metaLoading} />
        <BusinessLogoSettings />
      </aside>

      <div className="order-2 flex min-w-0 flex-col gap-8 lg:order-1">
        <BookingLinkCard variant="permanent" />

        <BusinessProfileSettings
          form={form}
          loading={metaLoading}
          onFormChange={setForm}
          onSaved={handleProfileSaved}
        />
        <BusinessGstSettings />
        <BusinessSecuritySettings />
        <BusinessTermsSettings />

        {/* <section>
          <h2 className="font-display text-headline-sm font-semibold text-on-surface">
            Quick links
          </h2>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">
            Jump to other areas you manage from the dashboard.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
            {QUICK_LINKS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="group flex flex-col justify-between rounded-xl border border-outline-variant bg-surface-container-lowest p-card-padding transition-all hover:border-primary/30 hover:shadow-[0_4px_20px_rgba(15,23,42,0.06)]"
              >
                <div>
                  <div
                    className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${card.iconClass}`}
                  >
                    <span className="material-symbols-outlined">{card.icon}</span>
                  </div>
                  <h3 className="font-display text-headline-sm font-semibold text-on-surface">
                    {card.title}
                  </h3>
                  <p className="mt-2 font-body text-body-md text-on-surface-variant">
                    {card.description}
                  </p>
                </div>
                <span className="mt-6 inline-flex items-center gap-1 font-body text-[13px] font-semibold text-primary">
                  Open
                  <span className="material-symbols-outlined text-[18px]">
                    chevron_right
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section> */}
      </div>
    </div>
  );
}
