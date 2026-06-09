import { BookingLinkCard } from "@/components/booking-link-card";
import { BusinessGstSettings } from "@/components/business-gst-settings";
import { BusinessLogoSettings } from "@/components/business-logo-settings";
import { BusinessOwnerGuard } from "@/components/business-owner-guard";
import { BusinessProfileSettings } from "@/components/business-profile-settings";
import { BusinessTermsSettings } from "@/components/business-terms-settings";
import { DashboardShell } from "@/components/dashboard-shell";
import Link from "next/link";

const QUICK_LINKS = [
  {
    href: "/dashboard/services",
    title: "Services",
    description: "Inspection services, checklists, and durations.",
    icon: "handyman",
    iconClass: "bg-secondary/10 text-secondary",
  },
  {
    href: "/dashboard/items",
    title: "Item list",
    description: "Price catalog used on quotations.",
    icon: "inventory_2",
    iconClass: "bg-primary/10 text-primary",
  },
  {
    href: "/dashboard/team",
    title: "Team",
    description: "Staff accounts, roles, and availability.",
    icon: "groups",
    iconClass: "bg-primary/10 text-primary",
  },
  {
    href: "/dashboard/calendar",
    title: "Calendar",
    description: "Scheduled visits and job bookings.",
    icon: "calendar_month",
    iconClass: "bg-tertiary/10 text-tertiary",
  },
  {
    href: "/dashboard/customers",
    title: "Customers",
    description: "Customer records from inspections and sign-ups.",
    icon: "group",
    iconClass: "bg-tertiary/10 text-tertiary",
  },
  {
    href: "/dashboard/quotations",
    title: "Quotations",
    description: "Create, send, and track customer quotes.",
    icon: "request_quote",
    iconClass: "bg-secondary/10 text-secondary",
  },
] as const;

export default function SettingsPage() {
  return (
    <DashboardShell
      title="Settings"
      subtitle="Booking link, business profile, branding, tax, and quotation defaults."
    >
      <BusinessOwnerGuard>
        <div className="flex flex-col gap-8">
          <BookingLinkCard variant="permanent" />

          <BusinessProfileSettings />
          <BusinessLogoSettings />
         {/* // <BusinessGstSettings /> */}
          <BusinessTermsSettings />

          <section>
            <h2 className="font-display text-headline-sm font-semibold text-on-surface">
              Quick links
            </h2>
            <p className="mt-1 font-body text-body-md text-on-surface-variant">
              Jump to other areas you manage from the dashboard.
            </p>

            <div className="mt-4 grid grid-cols-1 gap-gutter md:grid-cols-2 lg:grid-cols-3">
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
          </section>
        </div>
      </BusinessOwnerGuard>
    </DashboardShell>
  );
}
