import { validatePlanDescription } from "@/lib/subscription-plans/helpers";

export { validatePlanDescription as validateSmsPackageDescription };

export function formatMessageQuotaLabel(quota: number): string {
  if (quota < 0) return "Unlimited messages";
  if (quota === 1) return "1 message";
  return `${quota} messages`;
}

export function formatSmsPriceLabel(price: number): string {
  return `AU$${price}`;
}

/** Shown on plan cards — bundled SMS repeats each subscription period. */
export const SMS_BUNDLE_RENEWS_NOTE =
  "Renews with each subscription billing period";

export function formatBundledSmsInclusionLabel(
  name: string,
  messageQuota: number,
): string {
  return `${name} — ${formatMessageQuotaLabel(messageQuota)} included`;
}

/**
 * Catches the `SMS_500` / "50 messages" class of mistake: when the package
 * name carries a number, it should match the quota actually being sold.
 *
 * Returns a warning string, or null when the name and quota agree (or the
 * name carries no number to compare against).
 */
export function smsPackageNameQuotaWarning(
  name: string,
  messageQuota: number,
): string | null {
  if (messageQuota < 0) return null;

  // Take the largest number in the name - "SMS_500" -> 500, "Starter 100" -> 100.
  const numbers = name.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;

  const claimed = Math.max(...numbers.map((value) => Number.parseInt(value, 10)));
  if (!Number.isFinite(claimed) || claimed === messageQuota) return null;

  return `The name mentions ${claimed} but this package includes ${formatMessageQuotaLabel(messageQuota)}. Make the title and message count match.`;
}
