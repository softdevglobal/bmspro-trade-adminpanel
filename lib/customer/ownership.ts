export type CustomerOwnershipIdentity = {
  customerId: string;
  customerEmail: string;
  businessId?: string | null;
};

type OwnableRequest = {
  businessId: string;
  customerId: string | null;
};

/** Customer records are scoped to the authenticated UID and business. */
export function customerOwnsRequestRecord(
  request: OwnableRequest,
  identity: CustomerOwnershipIdentity,
): boolean {
  return Boolean(
    identity.businessId &&
    request.businessId === identity.businessId &&
    request.customerId &&
    request.customerId === identity.customerId
  );
}

export function customerOwnsNotificationRecord(
  data: Record<string, unknown>,
  identity: Pick<CustomerOwnershipIdentity, "customerId" | "businessId">,
): boolean {
  return Boolean(
    identity.businessId &&
    data.businessId === identity.businessId &&
    identity.customerId &&
    data.customerId === identity.customerId
  );
}
