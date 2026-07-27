import "server-only";

/**
 * Formats an AUD amount for SMS bodies using an "AUD" prefix rather than a `$`
 * glyph. Some SMS gateways/handsets downgrade `$` to `?` during GSM-7 encoding,
 * so we avoid the symbol entirely for text that goes out over SMS. (Email keeps
 * the `$` — it renders fine there.)
 */
export function formatSmsAud(value: number): string {
  return `AUD ${value.toLocaleString("en-AU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
