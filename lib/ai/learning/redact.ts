import type { KnowledgeFlag } from "../data/knowledge-sources";

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?:\+?\d[\s().-]*){8,}/g;            // 8+ digits with separators
const LONG_DIGITS = /\b(?:\d[ -]?){12,19}\b/g;      // card-like numbers

const INSTRUCTION_LIKE: RegExp[] = [
  /\bignore\b.{0,30}\b(previous|prior|above|earlier)\b.{0,30}\b(instructions?|rules?|prompts?)\b/i,
  /\bdisregard\b.{0,40}\b(instructions?|rules?)\b/i,
  /\b(system|developer)\s+(prompt|message|instructions?)\b/i,
  /\byou are now\b/i,
  /\bact as\b.{0,40}\b(assistant|ai|admin|developer)\b/i,
  /^\s*(system|assistant|developer|tool)\s*:/im,
  /<\/?\s*(system|instructions?|tool)\s*>/i,
  /\b(call|invoke|run)\b.{0,20}\b(tool|function)\b/i,
  /\b(create|cancel|confirm)\b.{0,20}\bbooking\b.{0,20}\bwithout\b/i,
];

/**
 * Flags owner-supplied text for review. Does not modify it: a business's own
 * phone number in an FAQ is fine once the owner confirms it.
 */
export function scanKnowledgeText(text: string): KnowledgeFlag[] {
  const flags = new Set<KnowledgeFlag>();
  if (new RegExp(EMAIL.source, "i").test(text) || new RegExp(PHONE.source).test(text) || new RegExp(LONG_DIGITS.source).test(text)) {
    flags.add("personal_data");
  }
  if (INSTRUCTION_LIKE.some(pattern => pattern.test(text))) flags.add("instruction_like");
  return [...flags];
}

/** Removes contact details and long digit runs from caller-supplied text. */
export function redactPersonalData(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(LONG_DIGITS, "[number]")
    .replace(PHONE, "[phone]")
    .replace(/\s{2,}/g, " ")
    .trim();
}
