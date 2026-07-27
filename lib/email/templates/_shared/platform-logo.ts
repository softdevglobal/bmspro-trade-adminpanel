import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { isPubliclyReachable } from "@/lib/config/base-url";
import { platformBrandLogoUrl } from "@/lib/email/templates/_shared/urls";

// `undefined` = not attempted yet, `null` = attempted and unavailable.
let cachedDataUri: string | null | undefined;

function embeddedLogo(): string | null {
  if (cachedDataUri !== undefined) return cachedDataUri;
  try {
    const filePath = path.join(process.cwd(), "public", "bms_pro_blue.jpeg");
    cachedDataUri = `data:image/jpeg;base64,${readFileSync(filePath).toString(
      "base64",
    )}`;
  } catch {
    cachedDataUri = null;
  }
  return cachedDataUri;
}

/**
 * `src` for the BMS Pro Trade logo in email headers.
 *
 * Prefers the hosted file. Gmail drops `data:` URI images, and on a deployment
 * `public/` is served from the CDN rather than mounted in the function
 * filesystem, so the embedded copy usually can't be read there anyway — between
 * them that is why the header logo rendered as a broken image.
 *
 * The data URI stays as the local-dev fallback, where the hosted URL would point
 * at localhost and be unreachable from a real inbox.
 */
export function platformBrandLogoSrc(): string | null {
  const hosted = platformBrandLogoUrl();
  if (hosted && isPubliclyReachable(hosted)) return hosted;
  return embeddedLogo() ?? hosted;
}
