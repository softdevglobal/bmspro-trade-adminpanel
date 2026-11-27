/**
 * Shadow-mode accuracy per email type for one business
 * (docs/sophie-email-learning-and-auto-reply.md §17, phase 1: at least 200 real emails).
 *
 *   npm run report:email-shadow -- <businessId> [days=30]
 *
 * Compares Sophie's guess on each sorted email with the type the owner confirmed on its card
 * (`ai_email_decisions`, written from step 5). Until cards exist it shows how many emails of each
 * type she saw, and how many AI requests failed. Private, system and blocked mail never reach the
 * AI and are not counted. Prints counts only, never email content.
 *
 * Uses the FIREBASE_ADMIN_* settings from .env.local.
 */
import { adminDb } from "../lib/firebase/admin";
import { shadowAccuracy, type ShadowSample } from "../lib/ai/email/accuracy";
import { EMAIL_TRIAGE_COLLECTION } from "../lib/ai/email/triage";
import type { EmailKind } from "../lib/ai/email/types";
import { Timestamp } from "firebase-admin/firestore";

/** Written by step 5's decisions.ts: one per owner decision, with `confirmedKind`. */
const EMAIL_DECISIONS_COLLECTION = "ai_email_decisions";
const MAX_ROWS = 5_000;
/** WriterFailure codes stored as aiError when the classifier didn't answer. */
const AI_FAILURES = new Set(["not_configured", "unreachable", "bad_status", "refused", "invalid"]);

async function main() {
  const [businessId, daysArg] = process.argv.slice(2);
  const days = Number(daysArg ?? 30);
  if (!businessId || !Number.isInteger(days) || days < 1 || days > 365) {
    console.error("Usage: npm run report:email-shadow -- <businessId> [days=30]");
    process.exit(1);
  }
  const since = Timestamp.fromMillis(Date.now() - days * 24 * 60 * 60_000);
  const rows = await adminDb.collection(EMAIL_TRIAGE_COLLECTION)
    .where("businessId", "==", businessId)
    .where("createdAt", ">=", since)
    .orderBy("createdAt", "desc")
    .select("result", "aiError", "decisionId", "precheck", "status")
    .limit(MAX_ROWS)
    .get();

  // Only email that went to the AI counts, whether or not the AI answered.
  const sorted = rows.docs.filter((doc) => doc.get("result") || AI_FAILURES.has(doc.get("aiError")));
  const decisionIds = sorted.map((doc) => doc.get("decisionId")).filter((id): id is string => typeof id === "string" && id !== "");
  const confirmed = new Map<string, EmailKind>();
  for (let start = 0; start < decisionIds.length; start += 100) {
    const refs = decisionIds.slice(start, start + 100).map((id) => adminDb.collection(EMAIL_DECISIONS_COLLECTION).doc(id));
    for (const snap of await adminDb.getAll(...refs)) {
      if (snap.exists && snap.get("businessId") === businessId && typeof snap.get("confirmedKind") === "string") {
        confirmed.set(snap.id, snap.get("confirmedKind") as EmailKind);
      }
    }
  }

  const samples: ShadowSample[] = sorted.map((doc) => ({
    guessed: (doc.get("result")?.kind as EmailKind | undefined) ?? null,
    confirmed: confirmed.get(String(doc.get("decisionId") ?? "")) ?? null,
  }));
  const report = shadowAccuracy(samples);
  const percent = (value: number | null) => (value === null ? "  –  " : `${(value * 100).toFixed(1).padStart(5)}%`);

  console.log(`\nSophie's email sorting, business ${businessId}, last ${days} days`);
  console.log(`Sorted by the AI: ${report.total} (AI failed: ${report.aiFailed}). Owner decided: ${report.decided}.`);
  console.log(`Overall accuracy: ${percent(report.accuracy)}${report.decided < 200 ? "  (phase 1 needs at least 200 decided emails)" : ""}\n`);
  console.log("type                      guessed  decided  right  precision  confirmed  found  recall");
  for (const row of report.byKind) {
    console.log(
      `${row.kind.padEnd(25)} ${String(row.guessed).padStart(7)}  ${String(row.decided).padStart(7)}  ${String(row.correct).padStart(5)}  ${percent(row.precision).padStart(9)}  ${String(row.confirmed).padStart(9)}  ${String(row.found).padStart(5)}  ${percent(row.recall)}`,
    );
  }
  if (rows.size >= MAX_ROWS) console.log(`\nOnly the newest ${MAX_ROWS} emails were read. Use fewer days.`);
}

main().catch((error) => {
  console.error("Report failed:", (error as Error)?.message ?? error);
  process.exit(1);
});
