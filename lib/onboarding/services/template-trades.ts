import { BUSINESS_TYPES } from "@/lib/onboarding/types";

/** Trades super admins can pick when creating global service templates. */
export const SERVICE_TEMPLATE_TRADES = BUSINESS_TYPES;

export type ServiceTemplateTrade =
  (typeof SERVICE_TEMPLATE_TRADES)[number]["id"];
