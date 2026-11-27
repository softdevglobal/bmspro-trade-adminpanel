/**
 * Firestore collections of Sophie's email work. Kept in one module so triage, decisions and rules
 * can all use them without importing each other. All are server-only (firestore.rules).
 */

/** One row per email Sophie sorted. */
export const EMAIL_TRIAGE_COLLECTION = "ai_email_triage";
/** One row per owner answer (or automatic rule run). */
export const EMAIL_DECISIONS_COLLECTION = "ai_email_decisions";
/** Exact rule versions: offered, approved, declined or demoted (§5). */
export const EMAIL_RULES_COLLECTION = "ai_email_rules";
