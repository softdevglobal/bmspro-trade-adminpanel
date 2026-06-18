/** Show sidebar warning when remaining SMS falls below this count. */
export const SMS_LOW_BALANCE_THRESHOLD = 10;

export type BusinessSmsBalance = {
  limit: number;
  used: number;
  /** `null` when the business has unlimited SMS. */
  remaining: number | null;
  isUnlimited: boolean;
  isLow: boolean;
  smsPackageId: string | null;
  smsPackageName: string | null;
};

export function parseBusinessSmsFields(
  data: Record<string, unknown>,
): BusinessSmsBalance {
  const limit =
    typeof data.smsMessageLimit === "number" && Number.isFinite(data.smsMessageLimit)
      ? data.smsMessageLimit
      : 0;
  const used =
    typeof data.smsMessagesUsed === "number" && Number.isFinite(data.smsMessagesUsed)
      ? Math.max(0, data.smsMessagesUsed)
      : 0;

  const isUnlimited = limit < 0;
  const remaining = isUnlimited ? null : Math.max(0, limit - used);
  const isLow =
    remaining !== null && remaining < SMS_LOW_BALANCE_THRESHOLD;

  const smsPackage = data.smsPackage as
    | { id?: string; name?: string }
    | null
    | undefined;
  const smsPackageId =
    typeof data.smsPackageId === "string" && data.smsPackageId.trim()
      ? data.smsPackageId.trim()
      : typeof smsPackage?.id === "string"
        ? smsPackage.id
        : null;
  const smsPackageName =
    typeof smsPackage?.name === "string" && smsPackage.name.trim()
      ? smsPackage.name.trim()
      : null;

  return {
    limit,
    used,
    remaining,
    isUnlimited,
    isLow,
    smsPackageId,
    smsPackageName,
  };
}

export function formatSmsRemainingLabel(balance: BusinessSmsBalance): string {
  if (balance.isUnlimited) return "Unlimited";
  return String(balance.remaining ?? 0);
}
