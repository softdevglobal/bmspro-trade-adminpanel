/**
 * Shadow-mode accuracy (docs/sophie-email-learning-and-auto-reply.md §17): how often Sophie's
 * guess matched the type the owner confirmed. Pure, for scripts/report-email-shadow-accuracy.ts.
 */

import type { EmailKind } from "./types";

export type ShadowSample = {
  /** Sophie's guess, or null when the AI failed. */
  guessed: EmailKind | null;
  /** The type the owner confirmed on the card (step 5), or null while undecided. */
  confirmed: EmailKind | null;
};

export type KindAccuracy = {
  kind: string;
  /** Emails Sophie put in this type. */
  guessed: number;
  /** Of those, how many the owner has decided, and how many she got right. */
  decided: number;
  correct: number;
  /** correct / decided: when she says this type, how often is she right? */
  precision: number | null;
  /** Emails the owner confirmed as this type, and how many of them she found. */
  confirmed: number;
  found: number;
  /** found / confirmed: of this type's emails, how many did she spot? */
  recall: number | null;
};

export type ShadowReport = {
  total: number;
  aiFailed: number;
  decided: number;
  correct: number;
  accuracy: number | null;
  byKind: KindAccuracy[];
};

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export function shadowAccuracy(samples: readonly ShadowSample[]): ShadowReport {
  const kinds = new Map<string, KindAccuracy>();
  const entry = (kind: string) => {
    let row = kinds.get(kind);
    if (!row) {
      row = { kind, guessed: 0, decided: 0, correct: 0, precision: null, confirmed: 0, found: 0, recall: null };
      kinds.set(kind, row);
    }
    return row;
  };
  let aiFailed = 0;
  let decided = 0;
  let correct = 0;
  for (const sample of samples) {
    if (!sample.guessed) aiFailed++;
    else entry(sample.guessed).guessed++;
    if (!sample.confirmed) continue;
    decided++;
    const right = sample.guessed === sample.confirmed;
    if (right) correct++;
    entry(sample.confirmed).confirmed++;
    if (right) entry(sample.confirmed).found++;
    if (sample.guessed) {
      entry(sample.guessed).decided++;
      if (right) entry(sample.guessed).correct++;
    }
  }
  const byKind = [...kinds.values()]
    .map((row) => ({ ...row, precision: ratio(row.correct, row.decided), recall: ratio(row.found, row.confirmed) }))
    .sort((a, b) => b.guessed - a.guessed || a.kind.localeCompare(b.kind));
  return { total: samples.length, aiFailed, decided, correct, accuracy: ratio(correct, decided), byKind };
}
