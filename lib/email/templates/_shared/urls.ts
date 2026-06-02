import "server-only";

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BOOKING_BASE_URL ?? "").replace(/\/+$/, "");
}

export function loginUrl(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/login` : null;
}

/** Public URL for the platform logo used in owner welcome emails. */
export function platformBrandLogoUrl(): string | null {
  const base = appBaseUrl();
  return base ? `${base}/bms_pro_blue.jpeg` : null;
}
