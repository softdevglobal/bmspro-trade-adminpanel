export const AU_COUNTRY_CODE = "+61";

/** Strips country code and leading zeros for display after +61. */
export function toAuLocalPhoneDigits(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0061")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("61") && digits.length >= 10) {
    digits = digits.slice(2);
  }
  while (digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

export function isValidAuLocalPhone(value: string, minDigits = 6): boolean {
  return toAuLocalPhoneDigits(value).length >= minDigits;
}

/** Formats a stored phone value for display with the +61 prefix. */
export function formatAuPhoneDisplay(value: string | null | undefined): string {
  const local = toAuLocalPhoneDigits(value ?? "");
  if (!local) return "";
  return `${AU_COUNTRY_CODE} ${local}`;
}
