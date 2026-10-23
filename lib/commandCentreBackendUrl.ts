/** Keep the review page destination and CSP allowlist on the same backend. */
export function commandCentreBackendUrl(value: string | undefined, development: boolean): string {
  const base = (value?.trim() || (development ? "http://127.0.0.1:5050/api" : "https://command-api.bmspros.com.au/api")).replace(/\/+$/, "");
  const url = new URL(base);
  if ((url.protocol !== "https:" && !(development && url.protocol === "http:")) || url.username || url.password || url.search || url.hash)
    throw new Error("NEXT_PUBLIC_COMMAND_CENTRE_BACKEND_URL must be an HTTPS API URL (HTTP is allowed during development only).");
  return url.toString().replace(/\/+$/, "");
}
