"use client";

import { BusinessSlotCapacitySettings } from "@/components/business-slot-capacity-settings";
import { BookingLinkCard } from "@/components/booking-link-card";
import { BusinessGstSettings } from "@/components/business-gst-settings";
import { BusinessProfileSettings } from "@/components/business-profile-settings";
import { BusinessSecuritySettings } from "@/components/business-security-settings";
import { BusinessTermsSettings } from "@/components/business-terms-settings";
import { BusinessTimezoneSettings } from "@/components/business-timezone-settings";
import { SettingsIdentityHero } from "@/components/settings-identity-hero";
import { useAuth } from "@/lib/auth/auth-context";
import { useBusinessProfile } from "@/lib/business/use-business-profile";
import type { BusinessProfilePlan } from "@/lib/onboarding/server";
import type { AuTimezone } from "@/lib/onboarding/types";
import { useEffect, useMemo, useState } from "react";

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
  slotCapacityJobs: number | null;
  slotCapacityInspectionRequests: number | null;
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
    slotCapacityJobs: null,
    slotCapacityInspectionRequests: null,
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
            slotCapacityJobs?: number | null;
            slotCapacityInspectionRequests?: number | null;
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
          slotCapacityJobs:
            typeof p.slotCapacityJobs === "number" ? p.slotCapacityJobs : null,
          slotCapacityInspectionRequests:
            typeof p.slotCapacityInspectionRequests === "number"
              ? p.slotCapacityInspectionRequests
              : null,
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

  const heroData = useMemo(
    () => ({
      businessName: form.businessName,
      businessEmail: user?.email?.trim() || form.businessEmail,
      abn: form.abn,
      businessPhone: form.businessPhone,
      businessAddress: form.businessAddress,
      state: meta.state,
      timezone: meta.timezone,
      plan: meta.plan,
      logoUrl: liveProfile?.logoUrl ?? meta.logoUrl,
    }),
    [form, user?.email, liveProfile?.logoUrl, meta],
  );

  function handleProfileSaved(next: ProfileFormState) {
    setForm(next);
  }

  function handleTimezoneSaved(timezone: AuTimezone) {
    setMeta((current) => ({ ...current, timezone }));
  }

  function handleSlotCapacitySaved(capacity: {
    slotCapacityJobs: number;
    slotCapacityInspectionRequests: number;
  }) {
    setMeta((current) => ({ ...current, ...capacity }));
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:gap-6">
      <SettingsIdentityHero {...heroData} loading={metaLoading} />

      <BookingLinkCard variant="permanent" />

      <BusinessProfileSettings
        form={form}
        loading={metaLoading}
        onFormChange={setForm}
        onSaved={handleProfileSaved}
      />

      <BusinessTimezoneSettings
        key={meta.timezone ?? "default-timezone"}
        timezone={meta.timezone}
        loading={metaLoading}
        onSaved={handleTimezoneSaved}
      />

      <BusinessSlotCapacitySettings
        slotCapacityJobs={meta.slotCapacityJobs}
        slotCapacityInspectionRequests={meta.slotCapacityInspectionRequests}
        loading={metaLoading}
        onSaved={handleSlotCapacitySaved}
      />

      <BusinessGstSettings />
      <BusinessSecuritySettings />

      <BusinessTermsSettings />
    </div>
  );
}
