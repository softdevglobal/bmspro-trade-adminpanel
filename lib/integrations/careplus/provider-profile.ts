export type CareplusProviderProfile = {
  id: string; name: string; abn: string; registrationNumber: string;
  address: string; phone: string; email: string; contactName: string; state: string;
};

/** Accept only the profile of the provider mapped to this Trade business. */
export function parseCareplusProviderProfile(body: unknown, expectedProviderId: string): CareplusProviderProfile {
  const root = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const provider = root.provider && typeof root.provider === "object" && !Array.isArray(root.provider) ? root.provider as Record<string, unknown> : {};
  if (root.view !== "provider" || !expectedProviderId || provider.id !== expectedProviderId || typeof provider.name !== "string" || !provider.name.trim()) {
    throw new Error("CarePlus returned a profile that does not match the connected provider.");
  }
  const text = (key: string, max: number) => typeof provider[key] === "string" ? String(provider[key]).trim().slice(0, max) : "";
  return {
    id: expectedProviderId, name: text("name", 160), abn: text("abn", 20),
    registrationNumber: text("registrationNumber", 80), address: text("address", 160),
    phone: text("phone", 30), email: text("email", 254), contactName: text("contactName", 160), state: text("state", 3),
  };
}
