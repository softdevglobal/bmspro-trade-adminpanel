import type { FieldType, OnboardingField, OnboardingInput, OnboardingSection } from "./types";
type Spec = string | [string, FieldType, string[]?];
const field = (spec: Spec, index: number): OnboardingField => {
  const [label, type, options] = typeof spec === "string" ? [spec, "textarea" as FieldType, undefined] : spec;
  return { id: `field-${index}`, label, type, value: "", ...(options ? { options } : {}) };
};
const section = (id: string, title: string, description: string, specs: Spec[]): OnboardingSection =>
  ({ id, title, description, fields: specs.map(field) });
const yesNo = ["Yes", "No"];
const consent = ["Yes", "No", "N/A"];
const evidence = ["Complete", "Pending", "N/A"];
const contactMethods = ["Phone call", "Text message (SMS)", "Email", "Video call", "In person", "Communication app or device", "Written letter", "Other"];
const languages = ["English", "Arabic", "Cantonese", "Dari", "Greek", "Hindi", "Italian", "Japanese", "Khmer", "Korean", "Mandarin", "Nepali", "Persian (Farsi)", "Punjabi", "Samoan", "Sinhala", "Spanish", "Tagalog", "Tamil", "Thai", "Turkish", "Urdu", "Vietnamese", "Other / not listed", "Not known yet"];
const copyMethods = ["Printed copy", "Email", "Accessible or alternate format", "Secure electronic copy", "Other"];
const providerAdoptionGuidance = [
  "Staff reference page - keep with the master onboarding pack. Official sources checked on 7 October 2026; recheck requirements before adoption and whenever services or rules change.",
  "NDIS Commission - Provision of supports: https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards/core-module-provision-supports",
  "NDIS Commission - Rights and responsibilities: https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards/core-module-rights-and-responsibilities",
  "NDIA - How to make a service agreement: https://www.ndis.gov.au/participants/working-providers/arranging-supports/how-make-service-agreement",
  "NDIA - Pricing arrangements: https://www.ndis.gov.au/providers/pricing-and-payments/pricing/pricing-arrangements",
  "Confirm legal entity details, complaints and privacy contacts, record access controls and retention policy. Review agreement terms, attach the completed support schedule, set review responsibilities, and keep participant consent restrictions visible to staff who need them.",
  "Check current pricing schedules and claiming guidance for each relevant support. For SIL, review applicable requirements, registration status and housing arrangements, and add participant-specific support and shared-living documentation before commencement.",
].join("\n\n");

export function createSupportSchedule(): OnboardingSection {
  return section("support-schedule", "ONB 03 B · Support and price schedule",
    "Repeat for each distinct support or rate. Amounts are in Australian dollars. Confirm current rules for the support and funding type; a maximum price is not automatically the agreed price. No charge is authorised unless specified, agreed and permitted by applicable rules. Only charge cancellation fees where the agreed term and applicable rules allow it. If the provider cancels and does not deliver the support, no fee is charged; discuss a replacement or suitable arrangement.", [
    "Support description, item number and agreed outcome", "Delivery location, days, times, frequency and staffing",
    ["Unit", "text"], ["Rate per unit (AUD)", "number"], ["Agreed quantity", "number"], ["Estimated total (AUD)", "number"],
    ["GST treatment / inclusion", "text"], "Funding management and invoice recipient", "Invoice frequency, payment terms and disputed invoice contact",
    "Provider travel and transport charges (specify None if absent)", "Non face to face or other charges (specify None if absent)",
    "Notice period, cancellation method and agreed cancellation calculation", "Applicable claiming conditions and pricing guidance version checked",
    "Budget exhaustion and price change arrangements", ["Participant agreement / initials", "text"], ["Provider initials", "text"], ["Agreement date", "date"],
  ]);
}

export function createRiskSection(): OnboardingSection {
  return section("risk", "Risk and agreed safeguards", "Consider falls, manual handling, health events, abuse or exploitation, environmental hazards and loss of essential supports. Discuss choices with the participant and add an entry for each risk, including the impact, agreed action, escalation, owner and due date.", [
    "Risk / likely impact", "Agreed action and escalation", ["Responsible person", "text"], ["Due date", "date"],
  ]);
}


export function createPackOverview(): OnboardingSection {
  return section("pack-overview", "NDIS participant onboarding pack", [
    "Forms for intake, consent, service agreements and initial assessment",
    "Use this pack with each participant to record their choices, agree on supports and identify what must be ready before services start. Replace provider placeholders and complete the forms together, using the participant’s preferred communication method.",
    "How to use this pack",
    "1. Complete the intake form and confirm who may make or support decisions.",
    "2. Explain privacy and record individual consent choices.",
    "3. Complete the initial assessment and resolve service commencement risks.",
    "4. Complete and agree the service agreement and support schedule.",
    "5. Give the participant copies and retain the completed records securely.",
    "Before using this onboarding pack",
    "Complete and review this onboarding form before treating it as a participant record. Using this form does not guarantee audit compliance. Adapt it to the provider’s actual services, registration conditions, policies and participant needs. Have the service agreement reviewed for the services and jurisdiction before use. A separate SIL-specific review and schedule are needed before using it for SIL; it is not a complete 0138 or tenancy agreement.",
    "Record actual dates and decisions. Do not backdate signatures or invent evidence. For existing participants, identify missing records and document a current review. Collect only information needed for the support.",
  ].join("\n\n"), [
    ["Provider name", "text"],
    ["Legal entity and trading name", "text"],
    ["ABN and NDIS registration ID", "text"],
    "Office address, phone and email",
    ["Template owner", "text"],
    ["Approved by", "text"],
    ["Adoption date", "date"],
    ["Next template review", "date"],
  ]);
}

/** Prepare older drafts for review; saving remains an explicit user action. */
export function upgradeOnboardingDraft(input: OnboardingInput): { form: OnboardingInput; addedOverview: boolean; addedChoices: boolean } {
  if (input.sections.some((item) => item.id === "maintenance" && item.title === "Template adoption and review")) input = {
    ...input,
    sections: input.sections.map((item) => item.id === "maintenance" && item.title === "Template adoption and review"
      ? { ...item, title: "Provider adoption and review", description: item.description.replace("of this template", "of this onboarding pack") }
      : item),
  };
  if (input.status !== "draft") return { form: input, addedOverview: false, addedChoices: false };

  let sections = [...input.sections];
  let addedOverview = false;
  let addedChoices = false;
  let templateVersion = input.templateVersion;

  if (templateVersion !== 2 && !sections.some((item) => item.id === "pack-overview")) {
    const overview = createPackOverview();
    const maintenance = sections.find((item) => item.id === "maintenance");
    overview.fields = overview.fields.map((item) => ({
      ...item, value: maintenance?.fields.find((previous) => previous.label === item.label)?.value || "",
    }));
    sections = [overview, ...sections];
    addedOverview = true;
    templateVersion = 2;
  } else if (sections.some((item) => item.id === "pack-overview")) {
    templateVersion = 2;
  }

  // Move provider adoption fields back to the opening page; older drafts stored
  // duplicate copies in both sections. Preserve conflicting values in a review note.
  const overviewIndex = sections.findIndex((item) => item.id === "pack-overview");
  const maintenanceIndex = sections.findIndex((item) => item.id === "maintenance");
  if (overviewIndex >= 0 && maintenanceIndex >= 0) {
    const overview = { ...sections[overviewIndex], fields: sections[overviewIndex].fields.map((field) => ({ ...field })) };
    const maintenance = { ...sections[maintenanceIndex], fields: sections[maintenanceIndex].fields.map((field) => ({ ...field })) };
    const moves = new Map([["Template owner", "Template owner"], ["Approved by", "Approved by"], ["Adoption date", "Adoption date"], ["Next template review", "Next template review"]]);
    const reviewNotes: string[] = [];
    const kept: OnboardingField[] = [];
    for (const field of maintenance.fields) {
      const targetLabel = moves.get(field.label);
      if (!targetLabel) { kept.push(field); continue; }
      const target = overview.fields.find((candidate) => candidate.label === targetLabel);
      if (!target) { kept.push(field); continue; }
      if (!target.value.trim()) target.value = field.value;
      else if (field.value.trim() && target.value !== field.value) reviewNotes.push(`${field.label}: ${field.value}`);
    }
    if (reviewNotes.length) {
      const previousNote = kept.find((field) => field.label === "Previous provider adoption details - review values");
      if (previousNote) previousNote.value = [previousNote.value, ...reviewNotes].filter(Boolean).join("\n");
      else kept.push({ id: crypto.randomUUID(), label: "Previous provider adoption details - review values", type: "textarea", value: reviewNotes.join("\n") });
    }
    if (!maintenance.description.includes("ndiscommission.gov.au/rules-and-standards")) {
      maintenance.description = [maintenance.description, providerAdoptionGuidance].filter(Boolean).join("\n\n");
    }
    sections[overviewIndex] = overview;
    sections[maintenanceIndex] = { ...maintenance, fields: kept };
  }

  sections = sections.map((item) => {
    if (item.id !== "agreement-c" || item.fields.some((field) => field.type === "signature")) return item;
    const index = item.fields.findIndex((field) => field.label === "Participant signature / recorded agreement");
    if (index < 0) return item;
    const fields = item.fields.map((field, position) => position === index ? { ...field, label: "Participant recorded agreement (if not signing)" } : field);
    fields.splice(index, 0, { id: crypto.randomUUID(), label: "Participant signature", type: "signature", value: "" });
    return { ...item, fields };
  });
  const intakeIndex = sections.findIndex((item) => item.id === "intake-a");
  if (intakeIndex >= 0) {
    const intake = { ...sections[intakeIndex], fields: sections[intakeIndex].fields.map((field) => ({ ...field })) };
    const defaults = createOnboardingTemplate().find((item) => item.id === "intake-a")?.fields || [];
    const addDefault = (label: string) => {
      if (intake.fields.some((item) => item.label.trim().toLowerCase() === label.toLowerCase())) return;
      const field = defaults.find((item) => item.label === label);
      if (field) intake.fields.push({ ...field, id: crypto.randomUUID(), value: "" });
      addedChoices = true;
    };

    const oldContact = intake.fields.find((item) => item.label === "Preferred safe contact method");
    if (oldContact && oldContact.type !== "select") {
      oldContact.label = "Previous contact method (review and select below)";
      addedChoices = true;
    }
    const oldLanguage = intake.fields.find((item) => item.label === "Preferred language, communication method and aids");
    if (oldLanguage) {
      oldLanguage.label = "Previous language and communication details (review below)";
      addedChoices = true;
    }
    addDefault("Preferred safe contact method");
    addDefault("Other contact method (if selected)");
    addDefault("Preferred language");
    addDefault("Other language (if selected)");
    addDefault("Preferred communication method and aids");
    addDefault("Safe times or contact restrictions");
    if (addedChoices) sections[intakeIndex] = intake;
  }

  return {
    form: { ...input, sections, ...(templateVersion !== undefined ? { templateVersion } : {}) },
    addedOverview, addedChoices,
  };
}
export function createOnboardingTemplate(): OnboardingSection[] {
  return [
    createPackOverview(),
    section("intake-a", "ONB 01 A · Participant intake", "Record actual dates and verified decision authority. A family relationship or nominee status alone does not authorise every decision.", [
      ["Completed on", "date"], ["Completed by and role", "text"], ["Full name", "text"], ["Preferred name", "text"],
      ["Date of birth", "date"], ["NDIS number (if needed)", "text"], "Home address", "Service delivery address (if different)",
      ["Phone", "tel"], ["Email", "email"], ["Preferred safe contact method", "select", contactMethods], ["Other contact method (if selected)", "text"],
      ["Preferred language", "select", languages], ["Other language (if selected)", "text"],
      "Preferred communication method and aids", ["Safe times or contact restrictions", "text"],
      "Interpreter, accessible format or decision support", "Cultural, religious, privacy and worker preferences",
      "Emergency contact name, relationship and phone", "Chosen support person / advocate and contact details",
      ["Does anyone claim decision authority?", "select", yesNo], "Authority name, type, scope, expiry and evidence location",
    ]),
    section("intake-b", "ONB 01 B · Supports and funding", "", [
      "Referral source and reason for seeking support", "Requested services, location, frequency and preferred start date", "Participant goals and what a good service looks like",
      ["Funding management", "select", ["NDIA", "Plan managed", "Self managed", "Mixed"]], "Mixed funding details",
      "Relevant plan dates, support category and agreed available budget", "Plan manager / invoice recipient and contact details",
      "Support coordinator / other providers to involve with permission", "Urgent safety or continuity concerns and action taken",
      ["Intake outcome", "select", ["Proceed to assessment", "More information needed", "Referral / unable to offer"]],
      "Reason, participant discussion and alternative referral offered", "Next action and responsible person", ["Next action due", "date"],
      ["Participant / supporter involvement recorded by", "text"], ["Involvement date", "date"],
    ]),
    section("consent", "ONB 02 · Participant consent record",
      "Explain each choice and record limits. A blank response is not consent. Declining optional sharing or media use must not automatically prevent support. Explain that relevant identity, contact, funding and support information is used to organise and deliver agreed services, manage safety and keep service records, and that access is restricted to authorised people. Information may be disclosed without consent where required or permitted by law. This record grants no permission for photos, publicity, medical treatment, restrictive practices or financial control. Consent may be changed or withdrawn through the privacy contact; explain any effect on support and records that must be retained. Withdrawal does not undo lawful actions already taken.", [
      "Explained purposes for collection, use and lawful disclosure of relevant identity, contact, funding and support information",
      "Privacy contact and how to request access or correction", ["Privacy notice version", "text"], ["Privacy notice given on", "date"], ["Format explained", "select", ["Verbal explanation", "Easy Read", "Written information", "Interpreter used", "Accessible format", "Other"]],
      ["Collect and use relevant personal and sensitive information for explained support purposes", "select", yesNo],
      ["Contact nominated support people for listed purposes", "select", consent],
      ["Exchange relevant information with named professionals / providers", "select", consent],
      ["Share relevant billing information with nominated plan manager", "select", consent],
      "Named recipients, information to share, purpose and restrictions", ["Consent starts", "date"], ["Consent expiry / review due", "date"],
      "How understanding was checked, questions answered and support provided", "Participant name and signature / recorded agreement", ["Participant agreement date", "date"],
      "Representative and verified authority evidence", "Staff name and signature / recorded agreement", ["Staff agreement date", "date"],
      ["Copy provided on", "date"], ["Copy method", "select", copyMethods], ["Restrictions entered in record", "select", yesNo],
    ]),
    section("agreement-a", "ONB 03 A · Participant service agreement",
      "Complete all terms and schedules before agreeing. We will deliver the supports described in Part B at agreed times and locations, discuss changes, confirm agreed variations in writing and give you an updated copy. We will treat you respectfully, protect privacy, provide competent workers, explain information accessibly, listen to preferences and respond to concerns. Tell us your preferences and relevant safety changes, let us know when appointments change, and pay only agreed amounts properly payable. You may use an advocate, ask questions, request changes, complain without retaliation and choose other providers. This agreement does not waive legal or consumer rights. A support person is not personally liable simply because they assist. No additional service or fee is agreed by leaving a field blank. You can contact the NDIS Quality and Safeguards Commission at www.ndiscommission.gov.au without first complaining to us.", [
      "Provider legal name, trading name, ABN and NDIS registration ID", "Provider address, phone, email and service contact",
      "Participant full name and address", "Representative, authority scope and evidence checked",
      ["Start date", "date"], ["End / review date", "date"], "Attachments and versions",
      "Provider responsibilities: respectful support, privacy, competent workers, accessible information and notification of changes",
      "Participant responsibilities: preferences, relevant safety changes, appointment changes and agreed payable amounts",
      "Choice, advocacy, complaints without retaliation and ability to choose other providers",
      "Provider complaints contact and response timeframe",
    ]),
    createSupportSchedule(),
    section("agreement-c", "ONB 03 C · Continuity and agreement record",
      "A representative agrees only within verified authority. For an immediate threat to life or safety call 000. Provider contacts do not replace emergency services. Informed dignity of risk choices alone must not cause support to stop.", [
      "Urgent provider contact, available hours and backup contact", "Backup support for worker absence or service disruption",
      "Individual emergency plan reference and date", "Notice arrangements for ending / changing services and method of notification",
      "Transition arrangements, essential supports and information handover with consent",
      "Acknowledgement: supports, fees, choices, complaints and schedules discussed; opportunity for questions and advice",
      ["Participant name", "text"], ["Participant signature", "signature"], "Participant recorded agreement (if not signing)", ["Participant agreement date", "date"],
      "Representative name, signature and authority evidence reference", ["Representative agreement date", "date"],
      "Provider representative, role and signature / recorded agreement", ["Provider agreement date", "date"],
      "Interpreter / support person and how agreement was explained", ["Copy supplied on", "date"], ["Copy method / accessible format", "select", copyMethods],
      "If unsigned or copy declined: circumstances, agreed terms and next action",
    ]),
    section("assessment-a", "ONB 04 A · Initial needs and safety assessment",
      "Record the participant's own account and relevant observations. This is an initial support assessment, not a clinical diagnosis; refer specialist matters to a suitably qualified professional. For each support area, select Independent, Support needed, Not relevant or Unknown, then describe the required help and refer to existing professional plans where applicable.", [
      ["Assessment date", "date"], ["Assessor and role", "text"], "Participant and others involved with permission",
      "What matters to me, my strengths and desired outcomes", "My routines, preferences, boundaries and things I do independently",
      ...["Personal care and daily routines", "Mobility, transfers and equipment", "Meals, swallowing and nutrition", "Medication and health monitoring",
        "Communication and decision support", "Community access and transport", "Distress, behaviour and emotional wellbeing", "Home safety and social connections"]
        .flatMap((area): Spec[] => [[area + " — status", "select", ["Independent", "Support needed", "Not relevant", "Unknown"]], area + " — help / plan reference"]),
      "Allergies, urgent health information and existing emergency plans", "Clinical / specialist referrals and responsible person",
    ]),
    createRiskSection(),
    section("assessment-b", "ONB 04 B · Actions and commencement", "A checklist tick alone is not evidence. Keep dated delivery notes after each service; this pack does not show that support occurred.", [
      "Support disruption impact and backup arrangements", "Worker skills, equipment and specialist plans needed before starting",
      ...["Intake and authority checks", "Consent and privacy explanation", "Agreement, schedule and participant copy", "Individual and specialist support plans", "Risk controls, emergency plan and worker briefing"]
        .flatMap((record): Spec[] => [[record + " — status", "select", evidence], record + " — evidence reference"]),
      ["Commencement decision", "select", ["Ready", "Ready subject to listed controls", "Defer pending actions"]],
      "Outstanding actions, owners and due dates", "Participant views / agreement", "Assessor signature / recorded agreement", ["Assessor agreement date", "date"],
      "Manager approval / recorded agreement", ["Manager approval date", "date"], ["Support plan review due", "date"], "Earlier review triggers",
      "Start arrangements confirmed with participant and assigned workers briefed",
    ]),
    section("maintenance", "Provider adoption and review", providerAdoptionGuidance, [
      "Reviewed by and role", "Changes made and version issued", ["Approval date", "date"], ["Next review date", "date"],
    ]),
  ];
}

/** Keep the opening guidance current for previously saved onboarding records. */
export function onboardingGuidance(description: string): string {
  return description
    .replace("Editable templates for intake, consent, service agreements and initial assessment", "Forms for intake, consent, service agreements and initial assessment")
    .replace("Before adopting the templates", "Before using this onboarding pack")
    .replace("This is a working template, not a completed record or a guarantee of audit compliance.", "Complete and review this onboarding form before treating it as a participant record. Using this form does not guarantee audit compliance.");
}
