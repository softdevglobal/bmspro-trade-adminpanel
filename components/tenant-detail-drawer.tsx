"use client";

import {
  formatTenantDate,
  timezoneLabel,
  type TenantDetail,
} from "@/lib/onboarding/tenant-display";
import { iconForBusinessType } from "@/lib/onboarding/types";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

type Props = {
  tenant: TenantDetail | null;
  onClose: () => void;
};

const STATUS_LABEL: Record<TenantDetail["status"], string> = {
  pending_review: "Pending review",
  active: "Active",
  suspended: "Suspended",
};

const STATUS_BADGE: Record<TenantDetail["status"], string> = {
  pending_review:
    "bg-tertiary-fixed text-on-tertiary-fixed-variant border border-on-tertiary-fixed-variant/30",
  active: "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20",
  suspended:
    "bg-error-container text-on-error-container border border-error/30",
};

const panelTransition = {
  type: "spring" as const,
  damping: 32,
  stiffness: 340,
  mass: 0.85,
};

export function TenantDetailDrawer({ tenant, onClose }: Props) {
  const open = tenant !== null;

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence mode="wait">
      {tenant ? (
        <DrawerPanel key={tenant.id} tenant={tenant} onClose={onClose} />
      ) : null}
    </AnimatePresence>
  );
}

function DrawerPanel({
  tenant,
  onClose,
}: {
  tenant: TenantDetail;
  onClose: () => void;
}) {
  const ownerName = tenant.owner?.fullName || "—";
  const ownerEmail = tenant.owner?.email || tenant.businessEmail || "—";

  return (
    <div className="fixed inset-0 z-[100]">
      <motion.button
        type="button"
        aria-label="Close details"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="absolute inset-0 bg-on-background/45 backdrop-blur-[2px]"
      />

      <motion.aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="tenant-detail-title"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={panelTransition}
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-outline-variant bg-background shadow-2xl will-change-transform"
      >
        <motion.header
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08, duration: 0.28, ease: "easeOut" }}
          className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant px-5 py-4"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
              <span className="material-symbols-outlined material-symbols-filled text-[24px]">
                {iconForBusinessType(tenant.businessType)}
              </span>
            </div>
            <div className="min-w-0">
              <h2
                id="tenant-detail-title"
                className="truncate font-display text-headline-sm font-semibold text-on-surface"
              >
                {tenant.businessName || "Business details"}
              </h2>
              <p className="mt-0.5 font-body text-[13px] text-on-surface-variant">
                {tenant.businessType}
              </p>
              <span
                className={`mt-2 inline-flex items-center rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${STATUS_BADGE[tenant.status]}`}
              >
                {STATUS_LABEL[tenant.status]}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-low"
            aria-label="Close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </motion.header>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.32, ease: "easeOut" }}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          <DetailSection title="Business">
            <DetailRow label="Business name" value={tenant.businessName} />
            <DetailRow label="Trade type" value={tenant.businessType} />
            <DetailRow label="ABN" value={tenant.abn || "—"} />
            <DetailRow
              label="Structure"
              value={tenant.businessStructure || "—"}
            />
            <DetailRow
              label="Registered for GST"
              value={tenant.registeredForGst ? "Yes" : "No"}
            />
          </DetailSection>

          <DetailSection title="Owner & contact">
            <DetailRow label="Owner name" value={ownerName} />
            <DetailRow label="Email" value={ownerEmail} />
            <DetailRow
              label="Phone"
              value={
                tenant.businessPhone
                  ? `+61 ${tenant.businessPhone}`
                  : "—"
              }
            />
          </DetailSection>

          <DetailSection title="Location">
            <DetailRow
              label="Address"
              value={tenant.businessAddress || "—"}
            />
            <DetailRow
              label="State & postcode"
              value={
                tenant.state && tenant.postcode
                  ? `${tenant.state}, ${tenant.postcode}`
                  : tenant.mainSuburb || "—"
              }
            />
            <DetailRow
              label="Timezone"
              value={timezoneLabel(tenant.timezone)}
            />
          </DetailSection>

          <DetailSection title="Plan">
            {tenant.plan ? (
              <>
                <DetailRow label="Plan" value={tenant.plan.name} />
                <DetailRow
                  label="Price"
                  value={`AU$${tenant.plan.price}/${tenant.plan.period}`}
                />
                {tenant.plan.trialDays ? (
                  <DetailRow
                    label="Free trial"
                    value={`${tenant.plan.trialDays} days`}
                  />
                ) : null}
              </>
            ) : (
              <DetailRow label="Plan" value="—" />
            )}
          </DetailSection>

          <DetailSection title="Account">
            <DetailRow
              label="Source"
              value={
                tenant.source === "self_signup"
                  ? "Self sign-up"
                  : "Super admin"
              }
            />
            <DetailRow
              label="Account active"
              value={tenant.isActive ? "Yes" : "No"}
            />
            <DetailRow
              label="Onboarding"
              value={
                tenant.onboardingStep
                  ? `${tenant.onboardingStep}${tenant.onboardingProgress != null ? ` (${tenant.onboardingProgress}%)` : ""}`
                  : "—"
              }
            />
            <DetailRow
              label="Created"
              value={formatTenantDate(tenant.createdAt)}
            />
            <DetailRow
              label="Last updated"
              value={formatTenantDate(tenant.updatedAt)}
            />
          </DetailSection>
        </motion.div>
      </motion.aside>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6 last:mb-0">
      <h3 className="mb-3 font-body text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">
        {title}
      </h3>
      <dl className="divide-y divide-outline-variant/60 rounded-xl border border-outline-variant bg-surface-container-lowest">
        {children}
      </dl>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="shrink-0 font-body text-[12px] font-semibold text-on-surface-variant">
        {label}
      </dt>
      <dd className="font-body text-[13px] text-on-surface sm:max-w-[58%] sm:text-right">
        {value}
      </dd>
    </div>
  );
}
