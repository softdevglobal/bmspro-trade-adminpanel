/** Parse "HH:MM" (24h) into minutes from midnight. */
export function parseClockMinutes(
  raw: string | null | undefined,
): number | null {
  if (!raw) return null;
  const parts = raw.split(":");
  const h = Number.parseInt(parts[0] ?? "", 10);
  const m = parts.length > 1 ? Number.parseInt(parts[1] ?? "", 10) : 0;
  if (Number.isNaN(h)) return null;
  return h * 60 + (Number.isNaN(m) ? 0 : m);
}
