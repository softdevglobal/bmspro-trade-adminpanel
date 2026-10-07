import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOnboardingTemplate } from "../lib/participant-onboarding/template";
import { fillProviderDetails } from "../lib/participant-onboarding/provider-details";
import { parseCareplusProviderProfile, type CareplusProviderProfile } from "../lib/integrations/careplus/provider-profile";
import type { OnboardingInput } from "../lib/participant-onboarding/types";

const profile: CareplusProviderProfile = {
  id: "provider-1", name: "Connected Care", abn: "51824753556", registrationNumber: "NDIS-123",
  address: "10 Test Road, Melbourne", phone: "0400000000", email: "contact@example.test", contactName: "Test Contact", state: "VIC",
};
const draft = (): OnboardingInput => ({ participantName: "Test participant", participantReference: "", status: "draft", sections: createOnboardingTemplate(), templateVersion: 2 });
describe("CarePlus onboarding provider autofill", () => {
  it("fills the opening page and agreement with linked provider details", () => {
    const input = draft();
    const result = fillProviderDetails(input, profile);
    assert.equal(result.filledFields, 6);
    const cover = result.form.sections.find((section) => section.id === "pack-overview")!;
    const value = (label: string) => cover.fields.find((field) => field.label === label)!.value;
    assert.equal(value("Provider name"), "Connected Care");
    assert.equal(value("Legal entity and trading name"), "Business name: Connected Care");
    assert.match(value("ABN and NDIS registration ID"), /ABN: 51824753556/);
    assert.match(value("ABN and NDIS registration ID"), /NDIS registration ID: NDIS-123/);
    assert.match(value("Office address, phone and email"), /contact@example.test/);
    const agreement = result.form.sections.find((section) => section.id === "agreement-a")!;
    assert.match(agreement.fields[0].value, /Connected Care/);
    assert.match(agreement.fields[1].value, /Contact person: Test Contact/);
    assert.equal(input.sections[0].fields[0].value, "");
  });
  it("preserves entered provider details and leaves participant, consent and approval fields alone", () => {
    const input = draft();
    input.sections[0].fields[0].value = "Manually entered provider";
    const result = fillProviderDetails(input, profile);
    assert.equal(result.form.sections[0].fields[0].value, "Manually entered provider");
    assert.equal(result.filledFields, 5);
    for (const id of ["intake-a", "intake-b", "consent", "maintenance"]) {
      assert.strictEqual(result.form.sections.find((section) => section.id === id), input.sections.find((section) => section.id === id));
    }
    for (const label of ["Template owner", "Approved by", "Adoption date", "Next template review"]) {
      assert.equal(result.form.sections[0].fields.find((field) => field.label === label)!.value, "");
    }
  });
  it("is idempotent and preserves completed records", () => {
    const first = fillProviderDetails(draft(), profile);
    const second = fillProviderDetails(first.form, { ...profile, name: "Changed provider" });
    assert.strictEqual(second.form, first.form);
    assert.equal(second.filledFields, 0);
    const completed = { ...draft(), status: "completed" as const };
    assert.strictEqual(fillProviderDetails(completed, profile).form, completed);
  });
  it("leaves forms usable without a connected profile and never substitutes a provider ID for registration", () => {
    const input = draft();
    assert.strictEqual(fillProviderDetails(input, null).form, input);
    const missing = { ...profile, abn: "", registrationNumber: "", address: "", phone: "", email: "", contactName: "" };
    const result = fillProviderDetails(input, missing);
    assert.equal(result.form.sections[0].fields.find((field) => field.label === "ABN and NDIS registration ID")!.value, "");
    assert.equal(result.form.sections[0].fields.find((field) => field.label === "Office address, phone and email")!.value, "");
    assert.ok(!JSON.stringify(result.form.sections).includes("provider-1"));
  });
  it("does not fill similarly named custom fields or reinterpret changed field types", () => {
    const input = draft();
    input.sections.push({ id: "custom", title: "Custom", description: "", fields: [{ id: "provider", label: "Provider name", type: "text", value: "" }] });
    input.sections[0].fields[0].type = "select";
    input.sections[0].fields[0].options = ["Another provider"];
    const result = fillProviderDetails(input, profile);
    assert.equal(result.form.sections.at(-1)!.fields[0].value, "");
    assert.equal(result.form.sections[0].fields[0].value, "");
  });
  it("fills repeated standard provider sections with blank responses", () => {
    const input = draft();
    const repeated = { ...input.sections[0], id: "duplicate-cover", fields: input.sections[0].fields.map((field) => ({ ...field })) };
    input.sections.push(repeated);
    const result = fillProviderDetails(input, profile);
    assert.equal(result.form.sections.at(-1)!.fields[0].value, profile.name);
  });
});
describe("CarePlus profile response validation", () => {
  it("accepts only whitelisted business data for the expected mapped provider", () => {
    const result = parseCareplusProviderProfile({ view: "provider", provider: { ...profile, privateNotes: "Do not expose", bmsSecret: "private" } }, profile.id);
    assert.deepEqual(result, profile);
    assert.equal("privateNotes" in result, false);
    assert.equal("bmsSecret" in result, false);
  });
  it("rejects another provider, an unexpected view and malformed responses", () => {
    for (const body of [null, [], { view: "staff", provider: profile }, { view: "provider", provider: { ...profile, id: "other-provider" } }, { view: "provider", provider: { ...profile, name: "" } }]) {
      assert.throws(() => parseCareplusProviderProfile(body, profile.id), /does not match/);
    }
  });
  it("leaves missing optional details blank", () => {
    const result = parseCareplusProviderProfile({ view: "provider", provider: { id: profile.id, name: profile.name } }, profile.id);
    assert.equal(result.abn, "");
    assert.equal(result.registrationNumber, "");
    assert.equal(result.address, "");
  });
});
