/**
 * RFC 9116 security.txt, served at /.well-known/security.txt.
 *
 * `Expires` is required by the RFC and must be under a year out. Computing it
 * six months ahead at request time means the file cannot silently go stale the
 * way a hardcoded date does — the trade-off is that it says "this contact is
 * current" rather than naming a review date the team committed to.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_ORIGIN =
  process.env.CANONICAL_ORIGIN ?? "https://trade.bmspros.com.au";

const SECURITY_CONTACT =
  process.env.SECURITY_CONTACT_EMAIL ?? "security@bmspros.com.au";

function expiresAt(): string {
  const expires = new Date();
  expires.setUTCMonth(expires.getUTCMonth() + 6);
  expires.setUTCMilliseconds(0);
  return expires.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function GET() {
  const body = [
    `Contact: mailto:${SECURITY_CONTACT}`,
    `Expires: ${expiresAt()}`,
    "Preferred-Languages: en",
    `Canonical: ${SITE_ORIGIN}/.well-known/security.txt`,
    `Policy: ${SITE_ORIGIN}/security`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
