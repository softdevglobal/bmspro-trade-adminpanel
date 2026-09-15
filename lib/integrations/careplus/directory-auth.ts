import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getCareplusMasterSecret } from "@/lib/integrations/careplus/config";
import {
  CAREPLUS_DIRECTORY_CANONICAL_PATH,
  CAREPLUS_DIRECTORY_PREFIX,
} from "@/lib/integrations/careplus/constants";

export class DirectoryAuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "DirectoryAuthError";
    this.status = status;
  }
}

function safeEqualHex(expected: string, received: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(received, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function tradeDirectorySignature(
  method: string,
  target: string,
  timestamp: string,
  master: string,
  body = "",
): string {
  const lines = [CAREPLUS_DIRECTORY_PREFIX, method, target, timestamp];
  if (method !== "GET") lines.push(body);
  return createHmac("sha256", master).update(lines.join("\n")).digest("hex");
}

export function canonicalDirectoryTarget(url: URL): string {
  const path = url.pathname.replace(/^\/api\/v1\//, "/api/");
  if (path !== CAREPLUS_DIRECTORY_CANONICAL_PATH) {
    throw new DirectoryAuthError(400, "Unknown CarePlus directory path.");
  }
  if (url.hash || url.username || url.password || url.search.length > 8000) {
    throw new DirectoryAuthError(400, "Invalid CarePlus directory request.");
  }
  return `${CAREPLUS_DIRECTORY_CANONICAL_PATH}${url.search}`;
}

export async function verifyCareplusDirectoryRequest(
  request: Request,
  rawBody = "",
  now = Date.now(),
): Promise<{ master: string }> {
  const master = getCareplusMasterSecret();
  if (!master) {
    throw new DirectoryAuthError(
      503,
      "Set BMS_CAREPLUS_MASTER_SECRET to the CarePlus BMS_WEBHOOK_SECRET.",
    );
  }

  const url = new URL(request.url);
  const target = canonicalDirectoryTarget(url);
  const timestamp = request.headers.get("x-bms-timestamp") || "";
  const signature = request.headers.get("x-bms-directory-signature") || "";
  if (
    !/^\d{13}$/.test(timestamp) ||
    Math.abs(now - Number(timestamp)) > 300_000 ||
    !/^[a-f0-9]{64}$/.test(signature)
  ) {
    throw new DirectoryAuthError(401, "Invalid directory signature or timestamp.");
  }

  const expected = tradeDirectorySignature(
    request.method.toUpperCase(),
    target,
    timestamp,
    master,
    rawBody,
  );
  if (!safeEqualHex(expected, signature.toLowerCase())) {
    throw new DirectoryAuthError(401, "Invalid directory signature or timestamp.");
  }
  return { master };
}
