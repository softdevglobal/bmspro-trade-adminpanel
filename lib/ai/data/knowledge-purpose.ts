/**
 * "What is this file?" for imported knowledge. The chosen description (plus the
 * owner's optional note) is added to the start of every passage from that entry,
 * so Sophie knows, for example, that a product list is this business's own
 * products for sale. No server-only imports: the dashboard uses this too.
 */
export const KNOWLEDGE_PURPOSES = ["products", "prices", "policies", "about", "other"] as const;
export type KnowledgePurpose = (typeof KNOWLEDGE_PURPOSES)[number];

export const PURPOSE_NOTE_MAX = 300;

/** Shown to the owner when choosing. */
export const PURPOSE_LABEL: Record<KnowledgePurpose, { title: string; hint: string }> = {
  products: { title: "Products we sell", hint: "Items you sell, with prices and/or stock" },
  prices: { title: "Our prices", hint: "Prices for your services, labour and call-outs" },
  policies: { title: "Our policies and terms", hint: "Warranty, payment, cancellation and similar" },
  about: { title: "Information about our business", hint: "Services, areas, about us" },
  other: { title: "Other", hint: "Describe it yourself" },
};

/** What Sophie reads at the top of each passage. Written about the business, not to the AI. */
const PURPOSE_TEXT: Record<Exclude<KnowledgePurpose, "other">, string> = {
  products: "These are products this business sells, with its own prices and stock.",
  prices: "These are this business's own prices for its services and labour.",
  policies: "These are this business's own policies and terms.",
  about: "This is information about this business.",
};

export const isKnowledgePurpose = (value: unknown): value is KnowledgePurpose =>
  (KNOWLEDGE_PURPOSES as readonly unknown[]).includes(value);

/** One plain line, or "" when no description was chosen (older entries). */
export function describePurpose(purpose: unknown, note: unknown): string {
  const cleanNote = typeof note === "string" ? note.replace(/\s+/g, " ").trim().slice(0, PURPOSE_NOTE_MAX) : "";
  if (!isKnowledgePurpose(purpose)) return "";
  const base = purpose === "other" ? "" : PURPOSE_TEXT[purpose];
  return [base, cleanNote].filter(Boolean).join(" ");
}

/** "Other" needs the owner's own words; the others work without a note. */
export function purposeError(purpose: unknown, note: unknown): string | null {
  if (!isKnowledgePurpose(purpose)) return "Choose what this file is.";
  if (typeof note === "string" && note.trim().length > PURPOSE_NOTE_MAX) return `Keep the note under ${PURPOSE_NOTE_MAX} characters.`;
  if (purpose === "other" && (typeof note !== "string" || note.trim().length < 3)) return "Describe what this file is.";
  return null;
}
