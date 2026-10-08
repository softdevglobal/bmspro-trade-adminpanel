import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOnboardingTemplate, createRiskSection, createSupportSchedule, upgradeOnboardingDraft } from "../lib/participant-onboarding/template";
import { validateOnboarding, type OnboardingInput } from "../lib/participant-onboarding/types";

const draft = (): OnboardingInput => ({ participantName: "Test participant", participantReference: "P-001", status: "draft", sections: createOnboardingTemplate() });
describe("Participant onboarding", () => {
  it("accepts an incomplete draft and retains explicitly unanswered consent", () => {
    const record = validateOnboarding(draft());
    assert.equal(record.sections.length, 11);
    const consent = record.sections.find((section) => section.id === "consent")!;
    assert.equal(consent.fields.filter((field) => field.type === "select" && field.options?.includes("N/A")).length, 3);
    assert.ok(consent.fields.every((field) => field.value === ""));
  });
  it("preserves declined consent without granting other permissions", () => {
    const input = draft();
    const choice = input.sections.find((section) => section.id === "consent")!.fields.find((field) => field.type === "select" && field.options?.includes("N/A"))!;
    choice.value = "No";
    assert.equal(validateOnboarding(input).sections.find((section) => section.id === "consent")!.fields.find((field) => field.id === choice.id)!.value, "No");
  });
  it("supports repeated schedules and risks with independent responses", () => {
    const input = draft();
    const schedule = createSupportSchedule(); schedule.id = "second-schedule"; schedule.fields[0].value = "Community support";
    const risk = createRiskSection(); risk.id = "second-risk"; risk.fields[0].value = "Falls";
    input.sections.push(schedule, risk);
    const result = validateOnboarding(input);
    assert.equal(result.sections.find((section) => section.id === "second-schedule")!.fields[0].value, "Community support");
    assert.equal(result.sections.find((section) => section.id === "support-schedule")!.fields[0].value, "");
    assert.equal(result.sections.find((section) => section.id === "second-risk")!.fields[0].value, "Falls");
  });
  it("accepts custom fields and ignores client-supplied tenant or audit fields", () => {
    const input = { ...draft(), businessId: "another-tenant", updatedBy: "spoofed" };
    input.sections.push({ id: "custom", title: "Preferences", description: "", fields: [{ id: "choice", label: "Preferred visit", type: "select", value: "Morning", options: ["Morning", "Afternoon"] }] });
    const result = validateOnboarding(input);
    assert.equal(result.sections.at(-1)!.fields[0].value, "Morning");
    assert.equal("businessId" in result, false);
    assert.equal("updatedBy" in result, false);
  });
  it("requires a participant name", () => {
    assert.throws(() => validateOnboarding({ ...draft(), participantName: " " }), /participant name/);
  });
  it("rejects duplicate section and field IDs", () => {
    const input = draft(); input.sections.push(input.sections[0]);
    assert.throws(() => validateOnboarding(input), /unique IDs/);
    const other = draft(); other.sections[0].fields.push(other.sections[0].fields[0]);
    assert.throws(() => validateOnboarding(other), /unique IDs/);
  });
  it("rejects unsupported field types and unlisted choices", () => {
    const input = draft();
    assert.throws(() => validateOnboarding({ ...input, sections: [{ ...input.sections[0], fields: [{ id: "x", label: "Test", type: "html", value: "" }] }] }), /field type/);
    input.sections.find((section) => section.id === "consent")!.fields.find((field) => field.type === "select")!.value = "Assumed";
    assert.throws(() => validateOnboarding(input), /choice/);
  });
  it("rejects invalid dates, email addresses and numeric values", () => {
    for (const [type, value] of [["date", "2026-02-31"], ["email", "wrong-email"], ["number", "Infinity"]]) {
      assert.throws(() => validateOnboarding({ ...draft(), sections: [{ id: "test", title: "Test", description: "", fields: [{ id: "test", label: "Test", type, value }] }] }), /valid/);
    }
  });
  it("rejects oversized forms and malformed data", () => {
    assert.throws(() => validateOnboarding(null), /Invalid/);
    assert.throws(() => validateOnboarding({ ...draft(), sections: [] }), /between 1 and 50/);
    const input = draft(); input.sections[0].fields[0].value = "x".repeat(6001);
    assert.throws(() => validateOnboarding(input), /oversized/);
  });

  it("adds the opening page to legacy drafts without changing their existing answers", () => {
    const input = draft();
    input.sections = input.sections.filter((section) => section.id !== "pack-overview");
    const maintenance = input.sections.find((section) => section.id === "maintenance")!;
    maintenance.fields.find((field) => field.label === "Template owner")!.value = "Existing owner";
    input.sections.find((section) => section.id === "intake-a")!.fields[2].value = "Existing participant name";
    const original = JSON.stringify(input);
    const upgraded = upgradeOnboardingDraft(input);
    assert.equal(upgraded.addedOverview, true);
    assert.equal(upgraded.form.sections[0].id, "pack-overview");
    assert.equal(upgraded.form.sections[0].fields.find((field) => field.label === "Template owner")!.value, "Existing owner");
    assert.equal(upgraded.form.sections.find((section) => section.id === "intake-a")!.fields[2].value, "Existing participant name");
    assert.equal(JSON.stringify(input), original);
    assert.equal(validateOnboarding(upgraded.form).templateVersion, 2);
    const reopened = upgradeOnboardingDraft(upgraded.form);
    assert.equal(reopened.addedOverview, false);
    assert.deepEqual(reopened.form, upgraded.form);
  });
  it("preserves historical completed forms and intentional layout changes", () => {
    const completed = draft();
    completed.status = "completed";
    completed.sections = completed.sections.filter((section) => section.id !== "pack-overview");
    assert.strictEqual(upgradeOnboardingDraft(completed).form, completed);
    const customised = { ...completed, status: "draft" as const, templateVersion: 2 as const };
    assert.deepEqual(upgradeOnboardingDraft(customised).form, customised);
    assert.equal(upgradeOnboardingDraft(customised).addedOverview, false);
  });
  it("does not duplicate an existing opening page or accept an invalid template version", () => {
    const current = draft();
    assert.equal(upgradeOnboardingDraft(current).form.sections.filter((section) => section.id === "pack-overview").length, 1);
    assert.throws(() => validateOnboarding({ ...current, templateVersion: 99 }), /template version/);
  });
});
