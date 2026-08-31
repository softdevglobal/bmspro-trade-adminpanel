/**
 * Light-touch data-quality checks.
 *
 * These surface *warnings*, never hard errors — typos in customer, item and
 * staff names make quotes and invoices look unprofessional, but the owner is
 * always allowed to save what they typed.
 */

/** Common typos of well-known email domains, mapped to the correct spelling. */
const EMAIL_DOMAIN_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "bigpon.com.au": "bigpond.com.au",
};

/**
 * Local parts that are almost always a misspelling of a standard mailbox.
 * `suppot@…` is the real-world case that prompted this check.
 */
const LOCAL_PART_TYPOS: Record<string, string> = {
  suppot: "support",
  suport: "support",
  supprot: "support",
  acounts: "accounts",
  accunts: "accounts",
  admln: "admin",
  amdin: "admin",
  inffo: "info",
};

/**
 * Returns a warning when an address looks like a typo, or null when it looks
 * fine. The address is assumed to already be syntactically valid.
 */
export function emailTypoWarning(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;

  const [localPart, domain] = trimmed.split("@");
  if (!localPart || !domain) return null;

  const domainFix = EMAIL_DOMAIN_TYPOS[domain];
  if (domainFix) {
    return `Did you mean ${localPart}@${domainFix}?`;
  }

  const localFix = LOCAL_PART_TYPOS[localPart];
  if (localFix && localFix !== localPart) {
    return `Did you mean ${localFix}@${domain}?`;
  }

  return null;
}

/** Normalises an item code for comparison (case and spacing insensitive). */
export function normaliseItemCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, "");
}

/**
 * Returns an error message when `code` is already used by another item.
 * `currentId` is excluded so editing an item does not clash with itself.
 */
export function duplicateItemCodeError(
  code: string,
  items: ReadonlyArray<{ id: string; code: string | null }>,
  currentId?: string | null,
): string | null {
  const normalised = normaliseItemCode(code);
  if (!normalised) return null;

  const clash = items.find(
    (item) =>
      item.id !== currentId &&
      item.code != null &&
      normaliseItemCode(item.code) === normalised,
  );

  return clash
    ? `Item code "${code.trim()}" is already used by another item.`
    : null;
}

/**
 * Flags names that look sloppy on a customer-facing document: all-lowercase
 * starts, ALL CAPS words, and doubled spaces. Returns null when nothing is
 * obviously wrong.
 */
export function nameQualityWarning(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 2) return null;

  if (/\s{2,}/.test(trimmed)) {
    return "This name has extra spaces in it.";
  }

  const words = trimmed.split(/\s+/);

  // Ignore short tokens and anything with digits (model numbers, "4G").
  const alphaWords = words.filter(
    (word) => word.length > 2 && !/\d/.test(word),
  );

  if (
    alphaWords.length > 0 &&
    alphaWords.every((word) => word === word.toUpperCase())
  ) {
    return "This name is in ALL CAPS. Consider using normal capitalisation.";
  }

  if (/^[a-z]/.test(trimmed)) {
    return "This name starts with a lowercase letter.";
  }

  return null;
}
