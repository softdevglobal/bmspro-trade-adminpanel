import type { CareplusProviderProfile } from "@/lib/integrations/careplus/provider-profile";
import type { OnboardingInput } from "./types";

/** Provider boilerplate only; preserve answers, consents and completed records. */
export function fillProviderDetails(input: OnboardingInput, profile: CareplusProviderProfile | null): { form: OnboardingInput; filledFields: number } {
  if (!profile || input.status !== "draft") return { form: input, filledFields: 0 };
  const registration = [profile.abn && "ABN: " + profile.abn, profile.registrationNumber && "NDIS registration ID: " + profile.registrationNumber].filter(Boolean).join("\n");
  const contact = [
    profile.address && "Office address: " + profile.address,
    profile.phone && "Phone: " + profile.phone,
    profile.email && "Email: " + profile.email,
  ].filter(Boolean).join("\n");
  const values: Record<string, string> = {
    "Provider name": profile.name,
    "Legal entity and trading name": profile.name ? "Business name: " + profile.name : "",
    "ABN and NDIS registration ID": registration,
    "Office address, phone and email": contact,
    "Provider legal name, trading name, ABN and NDIS registration ID": [
      profile.name && "Business name: " + profile.name, registration,
    ].filter(Boolean).join("\n"),
    "Provider address, phone, email and service contact": [
      contact, profile.contactName && "Contact person: " + profile.contactName,
    ].filter(Boolean).join("\n"),
  };
  let filledFields = 0;
  const sections = input.sections.map((section) => {
    // Include duplicate standard provider sections, but never arbitrary custom fields.
    if (section.id !== "pack-overview" && section.id !== "agreement-a" &&
        section.title !== "NDIS participant onboarding pack" && section.title !== "ONB 03 A · Participant service agreement") return section;
    const fields = section.fields.map((field) => {
      const value = values[field.label];
      if (!value || field.value.trim() || (field.type !== "text" && field.type !== "textarea")) return field;
      filledFields++;
      return { ...field, value };
    });
    return fields.some((field, index) => field !== section.fields[index]) ? { ...section, fields } : section;
  });
  return { form: filledFields ? { ...input, sections } : input, filledFields };
}
