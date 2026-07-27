import "server-only";

/** True when running on a Vercel deployment rather than a local machine. */
function isDeployed(): boolean {
  return Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
}

function normalise(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function isLoopback(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(
    url,
  );
}

/**
 * First candidate that is a usable public origin, ignoring loopback addresses
 * once deployed so a stale build-time value can't ship localhost links.
 */
export function firstUsable(
  candidates: (string | undefined)[],
): string | null {
  const deployed = isDeployed();
  for (const candidate of candidates) {
    const url = normalise(candidate);
    if (url && !(deployed && isLoopback(url))) return url;
  }
  return null;
}

/**
 * Public origin for links we hand to customers — pay links, Checkout redirects
 * and Connect callbacks.
 *
 * `NEXT_PUBLIC_*` values are inlined into the bundle at `next build`, so they
 * carry whatever was set on the build machine and never pick up the deployment's
 * own environment. Reading them first is what put `http://localhost:3000` into
 * live quotation PDFs and emails, so runtime server variables win here and a
 * loopback value is ignored once deployed.
 *
 * Returns `null` when deployed with nothing usable configured, so callers can
 * decide between omitting a link and failing outright.
 */
export function resolveAppBaseUrl(): string | null {
  const configured = firstUsable([
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ]);
  if (configured) return configured;

  const deployed = isDeployed();

  // Vercel sets both at runtime: the stable custom domain in production, and the
  // deployment's own host on previews so branch deploys link to themselves.
  const vercelUrl = normalise(
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_URL,
  );
  if (vercelUrl) return vercelUrl;

  return deployed ? null : "http://localhost:3000";
}
