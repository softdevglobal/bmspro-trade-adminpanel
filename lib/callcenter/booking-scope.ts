/** The booking-only AI role must never inherit platform-wide agent permissions. */
export function bookingAgentCanAccess(
  uid: string,
  claims: { role?: unknown; aiFrontOffice?: unknown; brand?: unknown },
  agent: Record<string, unknown> | undefined,
  businessId: string,
  superAdmin: boolean,
): boolean {
  if (!uid) return false;
  const isAi = claims.aiFrontOffice === true || claims.role === "ai_receptionist" || agent?.accountType === "ai-front-office";
  if (isAi) {
    return claims.role === "ai_receptionist" && claims.aiFrontOffice === true && claims.brand === "trade" &&
      !!agent && agent.accountType === "ai-front-office" && agent.brand === "trade" && agent.role === "ai_receptionist" &&
      agent.isActive === true && agent.suspended !== true && !["inactive", "disabled", "suspended"].includes(String(agent.status)) &&
      agent.businessId === businessId && Array.isArray(agent.assignedBusinessIds) &&
      agent.assignedBusinessIds.length === 1 && agent.assignedBusinessIds[0] === businessId;
  }
  if (superAdmin) return true;
  if (!agent || agent.isActive === false || agent.suspended === true || ["inactive", "disabled", "suspended"].includes(String(agent.status))) return false;
  return agent.workshopOwnerUid === businessId ||
    (Array.isArray(agent.assignedBusinessIds) && agent.assignedBusinessIds.includes(businessId));
}
