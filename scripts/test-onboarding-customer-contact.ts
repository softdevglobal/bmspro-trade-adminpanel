import assert from "node:assert/strict";
import { test } from "node:test";
import { onboardingCustomerContact } from "../lib/participant-onboarding/customer-contact";
import { createOnboardingTemplate } from "../lib/participant-onboarding/template";
import type { OnboardingInput } from "../lib/participant-onboarding/types";
const form = (): OnboardingInput => ({ status: "completed", participantName: "Participant", participantReference: "", sections: createOnboardingTemplate() });
test("account uses participant email and phone, excluding provider and emergency contacts", () => {
  const input = form();
  input.sections[0].fields.find((field) => field.label === "Office address, phone and email")!.value = "provider@example.com";
  assert.equal(onboardingCustomerContact(input), null);
  const intake = input.sections.find((section) => section.id === "intake-a")!;
  intake.fields.find((field) => field.label === "Email")!.value = " Participant@Example.com ";
  intake.fields.find((field) => field.label === "Phone")!.value = "+61412345678";
  assert.deepEqual(onboardingCustomerContact(input), { email: "participant@example.com", phone: "+61412345678", fullName: "Participant" });
});
test("invalid contact is rejected even when the editable field is a text field", () => {
  const input = form();
  const email = input.sections.find((section) => section.id === "intake-a")!.fields.find((field) => field.label === "Email")!;
  email.type = "text"; email.value = "invalid";
  assert.throws(() => onboardingCustomerContact(input), /valid participant email/);
});
