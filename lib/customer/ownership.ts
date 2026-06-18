import { normalizeEmail } from "@/lib/customer/types";

export type CustomerOwnershipIdentity = {
  customerId: string;
  customerEmail: string;
  businessId?: string | null;
};

type OwnableRequest = {
  businessId: string;
  customerId: string | null;
  customer: { email: string };
};

function emailsMatch(left: string, right: string): boolean {
  return normalizeEmail(left) === normalizeEmail(right);
}

/**
 * Whether a signed-in customer may access a request/booking for their business.
 * Email-only matches require the same business (legacy requests without customerId).
 */
export function customerOwnsRequestRecord(
  request: OwnableRequest,
  identity: CustomerOwnershipIdentity,
): boolean {
  const businessId = identity.businessId?.trim() || null;

  if (
    request.customerId &&
    request.customerId === identity.customerId &&
    (!businessId || request.businessId === businessId)
  ) {
    return true;
  }

  if (!identity.customerEmail?.trim()) return false;
  if (!emailsMatch(request.customer.email, identity.customerEmail)) return false;

  return !businessId || request.businessId === businessId;
}

export function customerOwnsNotificationRecord(
  data: Record<string, unknown>,
  identity: CustomerOwnershipIdentity,
): boolean {
  const businessId = identity.businessId?.trim() || null;
  const notificationBusinessId =
    typeof data.businessId === "string" ? data.businessId : null;
  const notificationCustomerId =
    typeof data.customerId === "string" ? data.customerId : null;
  const notificationEmail =
    typeof data.customerEmail === "string" ? data.customerEmail : null;

  if (
    notificationCustomerId &&
    notificationCustomerId === identity.customerId &&
    (!businessId || notificationBusinessId === businessId)
  ) {
    return true;
  }

  if (!identity.customerEmail?.trim() || !notificationEmail) return false;
  if (!emailsMatch(notificationEmail, identity.customerEmail)) return false;

  return !businessId || notificationBusinessId === businessId;
}
