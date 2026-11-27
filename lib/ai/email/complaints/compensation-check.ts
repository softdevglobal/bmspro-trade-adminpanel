import type { ComplaintType } from "../types";

/**
 * The compensation check (docs/sophie-email-learning-and-auto-reply.md §10.10, build step 16). Pure:
 * it takes the facts and the owner's own guide and returns "applies", "doesn't apply" or "unknown",
 * and WRITES NOTHING. Refunds, discounts, credits and waived fees are the owner's or accounts' alone
 * (playbook C15, C16): Sophie only shows "your guide says $30 off" on the card, for one tap.
 *
 * The guide's words are saved as knowledge so Sophie can quote them; only the fixed fields here are
 * ever read as a rule, and nothing in them moves money by itself.
 */

export type CompensationGuide = {
  version: number;
  /** One line each, up to 5. */
  entries: CompensationEntry[];
};

export type CompensationEntry = {
  /** The owner's own words, shown on the card. */
  label: string;
  when: { kind: "late_over_minutes"; minutes: number } | { kind: "missed_visit" };
  /** What the owner would do. Only ever a proposal. */
  proposal: { kind: "discount"; amountAud: number } | { kind: "waive_call_out_fee" };
};

export type CompensationFacts = {
  type: ComplaintType | null;
  /** Minutes the visit started after the booked window ended; null when not recorded. */
  minutesAfterWindowEnd: number | null;
  /** Minutes after the window opened; null when not recorded. */
  minutesAfterWindowStart: number | null;
  jobStatus: string | null;
};

export type CompensationVerdict =
  | { verdict: "applies"; entry: CompensationEntry; proposal: string }
  | { verdict: "doesnt_apply"; entry: CompensationEntry }
  /** The records can't say, e.g. the visit start wasn't recorded. */
  | { verdict: "unknown"; entry: CompensationEntry; why: string };

const MAX_ENTRIES = 5;

export function parseCompensationGuide(raw: unknown): { ok: true; entries: CompensationEntry[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_ENTRIES) return { ok: false, error: `Add 1 to ${MAX_ENTRIES} lines.` };
  const entries: CompensationEntry[] = [];
  for (const item of raw) {
    const value = (item ?? {}) as Record<string, unknown>;
    const label = typeof value.label === "string" ? value.label.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const when = value.when as Record<string, unknown> | undefined;
    const proposal = value.proposal as Record<string, unknown> | undefined;
    if (label.length < 3) return { ok: false, error: "Describe each line in a few words." };
    let parsedWhen: CompensationEntry["when"] | null = null;
    if (when?.kind === "late_over_minutes" && Number.isInteger(when.minutes) && (when.minutes as number) >= 5 && (when.minutes as number) <= 480) {
      parsedWhen = { kind: "late_over_minutes", minutes: when.minutes as number };
    } else if (when?.kind === "missed_visit") parsedWhen = { kind: "missed_visit" };
    let parsedProposal: CompensationEntry["proposal"] | null = null;
    if (proposal?.kind === "discount" && typeof proposal.amountAud === "number" && proposal.amountAud > 0 && proposal.amountAud <= 10_000
      && Math.abs(proposal.amountAud * 100 - Math.round(proposal.amountAud * 100)) < 1e-6) {
      parsedProposal = { kind: "discount", amountAud: proposal.amountAud };
    } else if (proposal?.kind === "waive_call_out_fee") parsedProposal = { kind: "waive_call_out_fee" };
    if (!parsedWhen) return { ok: false, error: "Say when it applies: late by at least a number of minutes (5 to 480), or a missed visit." };
    if (!parsedProposal) return { ok: false, error: "Say what you'd do: a dollar amount off, or waive the call-out fee." };
    entries.push({ label, when: parsedWhen, proposal: parsedProposal });
  }
  return { ok: true, entries };
}

const proposalWords = (proposal: CompensationEntry["proposal"]) =>
  proposal.kind === "discount" ? `take $${proposal.amountAud.toFixed(2)} off` : "waive the call-out fee";

/** Does each line of the owner's guide apply to this complaint? Never writes anything. */
export function checkCompensation(guide: Pick<CompensationGuide, "entries">, facts: CompensationFacts): CompensationVerdict[] {
  return guide.entries.map((entry): CompensationVerdict => {
    if (entry.when.kind === "missed_visit") {
      if (facts.type === "missed_visit" || facts.jobStatus === "missed") return { verdict: "applies", entry, proposal: proposalWords(entry.proposal) };
      return facts.jobStatus === null ? { verdict: "unknown", entry, why: "The job's status isn't recorded." } : { verdict: "doesnt_apply", entry };
    }
    // Late: only measured from what was recorded, never from what the customer said.
    const late = facts.minutesAfterWindowEnd ?? facts.minutesAfterWindowStart;
    if (late === null) return { verdict: "unknown", entry, why: "When the visit started isn't recorded." };
    return late > entry.when.minutes
      ? { verdict: "applies", entry, proposal: proposalWords(entry.proposal) }
      : { verdict: "doesnt_apply", entry };
  });
}
