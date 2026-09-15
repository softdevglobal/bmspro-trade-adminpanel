import "server-only";

import { createHmac } from "node:crypto";

import {
  CAREPLUS_DEFAULT_DIRECTORY_LIST_ENDPOINT,
  CAREPLUS_DEFAULT_EVENTS_ENDPOINT,
  CAREPLUS_DEFAULT_LEARNING_ENDPOINT,
  CAREPLUS_DEFAULT_RECORDS_ENDPOINT,
  CAREPLUS_BMS_DIRECTORY_CANONICAL_PATH,
  CAREPLUS_LEARNING_CANONICAL_PATH,
} from "@/lib/integrations/careplus/constants";

export type CareplusEndpoints = {
  learningEndpoint: string;
  eventsEndpoint: string;
  recordsEndpoint: string;
  directoryListEndpoint: string;
};

function isLocalDevHost(url: URL): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]")
  );
}

function requireHttpsEndpoint(
  raw: string,
  label: string,
  allowedPaths: string[],
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }

  const localHttp = url.protocol === "http:" && isLocalDevHost(url);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  if (url.search || url.hash) {
    throw new Error(`${label} must not include a query or fragment.`);
  }
  if (!allowedPaths.includes(url.pathname)) {
    throw new Error(`${label} path is not an allowed CarePlus endpoint.`);
  }
  return url;
}

export function getCareplusEndpoints(): CareplusEndpoints {
  const learningRaw =
    process.env.BMS_CAREPLUS_LEARNING_ENDPOINT?.trim() ||
    CAREPLUS_DEFAULT_LEARNING_ENDPOINT;
  const eventsRaw =
    process.env.BMS_NDIS_ENDPOINT?.trim() ||
    process.env.BMS_CAREPLUS_EVENTS_ENDPOINT?.trim() ||
    CAREPLUS_DEFAULT_EVENTS_ENDPOINT;
  const recordsRaw =
    process.env.BMS_CAREPLUS_RECORDS_ENDPOINT?.trim() ||
    process.env.BMS_NDIS_RECORDS_ENDPOINT?.trim() ||
    (eventsRaw.replace(/\/$/, "").endsWith("/integrations/bms")
      ? `${eventsRaw.replace(/\/$/, "")}/records`
      : CAREPLUS_DEFAULT_RECORDS_ENDPOINT);
  const directoryListRaw =
    process.env.BMS_CAREPLUS_DIRECTORY_ENDPOINT?.trim() ||
    (learningRaw.replace(/\/$/, "").endsWith("/learning")
      ? `${learningRaw.replace(/\/$/, "").slice(0, -"/learning".length)}/directory`
      : CAREPLUS_DEFAULT_DIRECTORY_LIST_ENDPOINT);

  requireHttpsEndpoint(learningRaw, "CarePlus learning endpoint", [
    CAREPLUS_LEARNING_CANONICAL_PATH,
    "/api/v1/integrations/bms/learning",
  ]);
  requireHttpsEndpoint(eventsRaw, "CarePlus events endpoint", [
    "/api/v1/integrations/bms",
    "/api/integrations/bms",
  ]);
  requireHttpsEndpoint(recordsRaw, "CarePlus records endpoint", [
    "/api/v1/integrations/bms/records",
    "/api/integrations/bms/records",
  ]);
  requireHttpsEndpoint(directoryListRaw, "CarePlus directory endpoint", [
    CAREPLUS_BMS_DIRECTORY_CANONICAL_PATH,
    "/api/v1/integrations/bms/directory",
  ]);

  return {
    learningEndpoint: learningRaw.replace(/\/$/, ""),
    eventsEndpoint: eventsRaw.replace(/\/$/, ""),
    recordsEndpoint: recordsRaw.replace(/\/$/, ""),
    directoryListEndpoint: directoryListRaw.replace(/\/$/, ""),
  };
}

export function getCareplusMasterSecret(): string | null {
  const master = process.env.BMS_CAREPLUS_MASTER_SECRET?.trim();
  return master && master.length >= 32 ? master : null;
}

/** Same derivation CarePlus uses: HMAC-SHA256(platformMaster, exactBusinessId) as hex. */
export function deriveCareplusBusinessSecret(
  master: string,
  businessId: string,
): string {
  return createHmac("sha256", master).update(businessId).digest("hex");
}

export function getCareplusSecretForBusiness(
  businessId: string,
): string | null {
  const trimmedId = businessId.trim();
  if (!trimmedId) return null;

  const json = process.env.BMS_CAREPLUS_SECRETS_JSON?.trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (parsed && typeof parsed === "object") {
        const value = (parsed as Record<string, unknown>)[trimmedId];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    } catch {
      // Fall through to the single-tenant env pair or master derivation.
    }
  }

  const envBusinessId = process.env.BMS_BUSINESS_ID?.trim();
  const secret = process.env.BMS_NDIS_SECRET?.trim();
  if (envBusinessId && secret && envBusinessId === trimmedId) {
    return secret;
  }

  const master = getCareplusMasterSecret();
  if (master) return deriveCareplusBusinessSecret(master, trimmedId);

  return null;
}

export function isCareplusSecretConfigured(businessId: string): boolean {
  return Boolean(getCareplusSecretForBusiness(businessId));
}
