import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { platformBrandLogoUrl } from "@/lib/email/templates/_shared/urls";

let cachedDataUri: string | null = null;

/**
 * BMS Pro Trade logo for email headers — embedded so it loads in all clients
 * (external localhost URLs fail in real inboxes).
 */
export function platformBrandLogoDataUri(): string | null {
  if (cachedDataUri) return cachedDataUri;
  try {
    const filePath = path.join(process.cwd(), "public", "bms_pro_blue.jpeg");
    const buffer = readFileSync(filePath);
    cachedDataUri = `data:image/jpeg;base64,${buffer.toString("base64")}`;
    return cachedDataUri;
  } catch {
    return platformBrandLogoUrl();
  }
}
