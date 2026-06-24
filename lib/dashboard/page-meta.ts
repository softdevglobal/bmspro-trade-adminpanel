export type DashboardPageMeta = {
  title: string;
  subtitle?: string;
  icon?: string;
  hidePageHeader?: boolean;
  fullBleed?: boolean;
};

const DASHBOARD_PAGES: Record<string, DashboardPageMeta> = {
  "/dashboard": {
    title: "Dashboard",
    hidePageHeader: true,
  },
  "/dashboard/calendar": {
    title: "Calendar",
    subtitle: "View requests and bookings by day, week or month.",
    icon: "calendar_month",
  },
  "/dashboard/requests": {
    title: "Requests",
    subtitle: "Review customer requests, schedule visits and assign an inspector.",
    icon: "event_available",
  },
  "/dashboard/quotations": {
    title: "Quotations",
    subtitle: "Create and manage quotes sent to customers.",
    icon: "request_quote",
  },
  "/dashboard/quotations/new": {
    title: "Quotations",
    hidePageHeader: true,
    fullBleed: true,
  },
  "/dashboard/jobs": {
    title: "Jobs",
    subtitle:
      "Scheduled jobs from the normal request flow, or added directly when work is already agreed.",
    icon: "assignment",
  },
  "/dashboard/invoices": {
    title: "Invoices",
    subtitle: "Create and send invoices to your customers.",
    icon: "receipt_long",
  },
  "/dashboard/services": {
    title: "Services",
    subtitle:
      "Create and manage service templates and custom services for your business.",
    icon: "settings_suggest",
  },
  "/dashboard/team": {
    title: "Team management",
    subtitle: "Add, edit, suspend or remove team members for your business.",
    icon: "manage_accounts",
  },
  "/dashboard/team/management": {
    title: "Team management",
    subtitle: "Add, edit, suspend or remove team members for your business.",
    icon: "manage_accounts",
  },
  "/dashboard/team/attendance": {
    title: "Attendance",
    subtitle:
      "Review staff clock-in and clock-out times, with breaks deducted.",
    icon: "schedule",
  },
  "/dashboard/team/leave-requests": {
    title: "Leave requests",
    subtitle:
      "Review and approve staff time off. Approved days block new assignments.",
    icon: "beach_access",
  },
  "/dashboard/customers": {
    title: "Customers",
    subtitle: "People who have requested work through your booking page.",
    icon: "group",
  },
  "/dashboard/items": {
    title: "Item list",
    subtitle: "Reusable line items and prices for your quotations.",
    icon: "inventory_2",
  },
  "/dashboard/sms": {
    title: "SMS Credits",
    subtitle:
      "View your remaining SMS balance and top up when you need more messages.",
    icon: "sms",
  },
  "/dashboard/sms/log": {
    title: "SMS log",
    subtitle: "Outbound messages sent from your workshop.",
    icon: "history",
  },
  "/dashboard/sms/custom-messages": {
    title: "Custom messages",
    subtitle:
      "Send a text message — like seasonal greetings — to your customers.",
    icon: "campaign",
  },
  "/dashboard/sms/logs": {
    title: "SMS logs",
    subtitle: "A history of the SMS messages sent from your business.",
    icon: "history",
  },
  "/dashboard/sms-packages": {
    title: "SMS Packages",
    subtitle: "Manage SMS add-on packages for workshops.",
    icon: "sms",
    hidePageHeader: true,
  },
  "/dashboard/sms-packages/usage": {
    title: "SMS usage",
    subtitle: "Tenant SMS assignments and Stripe purchase history.",
    icon: "assignment",
  },
  "/dashboard/sms-packages/log": {
    title: "SMS log",
    subtitle: "Outbound SMS history across all workshops.",
    icon: "history",
  },
  "/dashboard/subscription": {
    title: "Subscription",
    subtitle:
      "View your plan, staff limits, and upgrade or downgrade when you need to.",
    icon: "workspace_premium",
  },
  "/dashboard/tenants": {
    title: "Tenants",
    subtitle:
      "Businesses onboarded onto BMS Pro Trade. View active and suspended tenants or onboard a new business directly.",
    icon: "domain",
  },
  "/dashboard/packages": {
    title: "Subscription Packages",
    subtitle: "Manage subscription plans for workshops.",
    icon: "inventory_2",
    hidePageHeader: true,
  },
  "/dashboard/packages/usage": {
    title: "Package usage",
    subtitle: "Tenant subscription assignments and Stripe purchase history.",
    icon: "assignment",
  },
  "/dashboard/custom-messages": {
    title: "Custom messages",
    subtitle: "Send a platform-wide announcement to business owners and staff.",
    icon: "campaign",
  },
  "/dashboard/audit-log": {
    title: "Audit logs",
    subtitle:
      "Review sign-ins, inspections, bookings, and other activity for your business.",
    icon: "history",
  },
  "/dashboard/settings": {
    title: "Settings",
    subtitle:
      "Manage your business profile, public link, tax, quotation defaults, and account security.",
    icon: "settings",
  },
};

export function resolveDashboardPageMeta(pathname: string): DashboardPageMeta {
  if (DASHBOARD_PAGES[pathname]) {
    return DASHBOARD_PAGES[pathname];
  }

  if (pathname.startsWith("/dashboard/quotations/")) {
    return DASHBOARD_PAGES["/dashboard/quotations/new"];
  }

  if (pathname.startsWith("/dashboard/team/")) {
    return DASHBOARD_PAGES["/dashboard/team/management"];
  }

  if (pathname.startsWith("/dashboard/sms-packages/")) {
    return DASHBOARD_PAGES["/dashboard/sms-packages"];
  }

  if (pathname.startsWith("/dashboard/sms/")) {
    return DASHBOARD_PAGES["/dashboard/sms"];
  }

  if (pathname.startsWith("/dashboard/packages/")) {
    return DASHBOARD_PAGES["/dashboard/packages"];
  }

  return DASHBOARD_PAGES["/dashboard"];
}
