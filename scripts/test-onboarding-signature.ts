import assert from "node:assert/strict";
import { test } from "node:test";
import { createOnboardingTemplate, upgradeOnboardingDraft } from "../lib/participant-onboarding/template";
import { validateOnboarding, type OnboardingInput } from "../lib/participant-onboarding/types";
import { parseSignature } from "../lib/participant-onboarding/signature";
const draft = (): OnboardingInput => ({ participantName: "Participant", participantReference: "", status: "draft", sections: createOnboardingTemplate() });
test("signature survives saving and reopening without altering its strokes", () => {
  const form = draft();
  const field = form.sections[6].fields.find((item) => item.type === "signature")!;
  field.value = JSON.stringify([[[1, 2], [400, 900]], [[500, 500]]]);
  const reopened = validateOnboarding(JSON.parse(JSON.stringify(validateOnboarding(form))));
  assert.equal(reopened.sections[6].fields.find((item) => item.type === "signature")!.value, field.value);
  field.value = "";
  assert.doesNotThrow(() => validateOnboarding(form));
});
test("signature validation rejects unsafe and oversized drawings", () => {
  for (const value of ['"<svg>"', '[[[-1,0]]]', '[[[0,1001]]]', '[[[1.5,0]]]', '[[]]', '[[[0,0,0]]]']) assert.throws(() => parseSignature(value));
  assert.throws(() => parseSignature(JSON.stringify([Array.from({ length: 1501 }, () => [1, 1])])));
});
test("older drafts keep written agreement when a blank signature pad is added", () => {
  const form = draft();
  const agreement = form.sections[6];
  agreement.fields = agreement.fields.filter((field) => field.type !== "signature");
  const previous = agreement.fields.find((field) => field.label === "Participant recorded agreement (if not signing)")!;
  previous.label = "Participant signature / recorded agreement";
  previous.value = "Agreed verbally using communication device";
  const upgraded = upgradeOnboardingDraft(form).form;
  assert.equal(upgraded.sections[6].fields.find((field) => field.id === previous.id)!.value, previous.value);
  assert.equal(upgraded.sections[6].fields.filter((field) => field.type === "signature").length, 1);
  assert.equal(upgradeOnboardingDraft(upgraded).form.sections[6].fields.filter((field) => field.type === "signature").length, 1);
  assert.doesNotThrow(() => validateOnboarding(upgraded));
});
