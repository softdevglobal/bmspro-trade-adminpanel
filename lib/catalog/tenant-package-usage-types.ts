export type TenantPackageUsageEntry = {
  businessId: string;
  /** Workshop / business tenant name shown in admin logs. */
  tenantName: string;
  businessName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  planId: string | null;
  planName: string | null;
  planPriceLabel: string | null;
  smsPackageId: string | null;
  smsPackageName: string | null;
  smsLimit: number;
  smsUsed: number;
  smsRemaining: number | null;
  /** True when SMS quota renews with the subscription plan (bundled). */
  smsBundled: boolean;
  billingStatus: string | null;
  subscriptionPeriodEnd: number | null;
};

export type TenantPackagePurchaseEntry = {
  id: string;
  businessId: string;
  tenantName: string;
  businessName: string;
  ownerName: string | null;
  ownerEmail: string | null;
  type: "subscription" | "sms_topup";
  planId: string | null;
  planName: string | null;
  planPriceLabel: string | null;
  smsPackageId: string | null;
  smsPackageName: string | null;
  fulfilledAt: number | null;
};

export type TenantPackageUsageCatalog = {
  usage: TenantPackageUsageEntry[];
  purchases: TenantPackagePurchaseEntry[];
  usageByPlanId: Record<string, TenantPackageUsageEntry[]>;
  usageBySmsPackageId: Record<string, TenantPackageUsageEntry[]>;
};
