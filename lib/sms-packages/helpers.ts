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

/** Shown on plan cards — bundled SMS does not repeat on subscription renewal. */
export const SMS_BUNDLE_FIRST_PERIOD_NOTE =
  "First billing period only — not included on renewal";

export function formatBundledSmsInclusionLabel(
  name: string,
  messageQuota: number,
): string {
  return `${name} — ${formatMessageQuotaLabel(messageQuota)} (first billing period)`;
}
