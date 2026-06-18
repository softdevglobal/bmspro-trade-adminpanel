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
