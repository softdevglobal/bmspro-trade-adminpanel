import type { OnboardingInput } from "./types";
/** Use only the participant intake contacts, never provider or emergency contacts. */
export function onboardingCustomerContact(form: OnboardingInput): { email: string; phone: string; fullName: string } | null {
  const intake = form.sections.find((section) => section.id === "intake-a");
  const answer = (label: string) => intake?.fields.find((field) => field.label.trim().toLowerCase() === label)?.value.trim() || "";
  const email = answer("email").toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid participant email in Participant intake before completing onboarding.");
  return { email, phone: answer("phone"), fullName: form.participantName };
}
