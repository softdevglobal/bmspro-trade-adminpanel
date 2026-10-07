export type FieldType = "text" | "textarea" | "date" | "email" | "tel" | "number" | "select";
export type OnboardingField = { id: string; label: string; type: FieldType; value: string; options?: string[] };
export type OnboardingSection = { id: string; title: string; description: string; fields: OnboardingField[] };
export type OnboardingInput = { templateVersion?: 1 | 2; participantName: string; participantReference: string; status: "draft" | "completed"; sections: OnboardingSection[] };
export type OnboardingRecord = OnboardingInput & { id: string; revision: number; updatedAt: string; createdAt: string };

export const FIELD_TYPES: FieldType[] = ["text", "textarea", "date", "email", "tel", "number", "select"];

/** Validate editable schemas as well as responses before storing sensitive records. */
export function validateOnboarding(raw: unknown): OnboardingInput {
  const fail = (message: string): never => { throw new Error(message); };
  const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail("Invalid form data.");
  const string = (value: unknown, max: number): string => typeof value === "string" && value.length <= max ? value : fail("Invalid or oversized text field.");
  const body = object(raw);
  if (body.templateVersion !== undefined && body.templateVersion !== 1 && body.templateVersion !== 2) fail("Invalid template version.");
  const participantName = string(body.participantName, 200).trim();
  if (!participantName) fail("Enter the participant name before saving.");
  const participantReference = string(body.participantReference, 200).trim();
  if (body.status !== "draft" && body.status !== "completed") fail("Invalid onboarding status.");
  if (!Array.isArray(body.sections) || body.sections.length < 1 || body.sections.length > 50) fail("Include between 1 and 50 sections.");
  const sectionIds = new Set<string>();
  let fieldCount = 0;
  const sections = (body.sections as unknown[]).map((rawSection) => {
    const section = object(rawSection);
    const id = string(section.id, 100);
    const title = string(section.title, 200).trim();
    if (!id || sectionIds.has(id) || !title) fail("Sections need unique IDs and a title.");
    sectionIds.add(id);
    if (!Array.isArray(section.fields) || section.fields.length > 80) fail("Too many fields in a section.");
    const fieldIds = new Set<string>();
    const fields = (section.fields as unknown[]).map((rawField) => {
      const field = object(rawField);
      const fieldId = string(field.id, 100);
      const label = string(field.label, 300).trim();
      if (!fieldId || fieldIds.has(fieldId) || !label) fail("Fields need unique IDs and a label.");
      fieldIds.add(fieldId);
      if (!FIELD_TYPES.includes(field.type as FieldType)) fail("Invalid field type.");
      const type = field.type as FieldType;
      const value = string(field.value, 6000);
      let options: string[] | undefined;
      if (type === "select") {
        if (!Array.isArray(field.options) || field.options.length < 1 || field.options.length > 30) fail("Choice fields need between 1 and 30 options.");
        options = (field.options as unknown[]).map((option) => string(option, 200).trim());
        if (options.some((option) => !option) || new Set(options).size !== options.length || (value && !options.includes(value))) fail("Invalid choice options or response.");
      }
      if (value && type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail("Enter a valid date.");
      if (value && type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail("Enter a valid email address.");
      if (value && type === "number" && !Number.isFinite(Number(value))) fail("Enter a valid number.");
      fieldCount++;
      return { id: fieldId, label, type, value, ...(options ? { options } : {}) };
    });
    return { id, title, description: string(section.description, 3000), fields };
  });
  if (fieldCount > 600 || JSON.stringify(sections).length > 300000) fail("This form is too large. Shorten the responses or remove unused fields.");
  return { participantName, participantReference, status: body.status as OnboardingInput["status"], sections, ...(body.templateVersion !== undefined ? { templateVersion: body.templateVersion as 1 | 2 } : {}) };
}
