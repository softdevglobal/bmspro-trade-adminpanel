import "server-only";

import {
  CAREPLUS_DEFAULT_EVENTS_ENDPOINT,
  CAREPLUS_DEFAULT_LEARNING_ENDPOINT,
  CAREPLUS_LEARNING_CANONICAL_PATH,
} from "@/lib/integrations/careplus/constants";

export type CareplusEndpoints = {
  learningEndpoint: string;
  eventsEndpoint: string;
};

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

  if (url.protocol !== "https:") {
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
    process.env.BMS_CAREPLUS_EVENTS_ENDPOINT?.trim() ||
    CAREPLUS_DEFAULT_EVENTS_ENDPOINT;

  requireHttpsEndpoint(learningRaw, "CarePlus learning endpoint", [
    CAREPLUS_LEARNING_CANONICAL_PATH,
    "/api/v1/integrations/bms/learning",
  ]);
  requireHttpsEndpoint(eventsRaw, "CarePlus events endpoint", [
    "/api/v1/integrations/bms",
    "/api/integrations/bms",
  ]);

  return {
    learningEndpoint: learningRaw.replace(/\/$/, ""),
    eventsEndpoint: eventsRaw.replace(/\/$/, ""),
  };
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
      // Fall through to the single-tenant env pair.
    }
  }

  const envBusinessId = process.env.BMS_BUSINESS_ID?.trim();
  const secret = process.env.BMS_NDIS_SECRET?.trim();
  if (envBusinessId && secret && envBusinessId === trimmedId) {
    return secret;
  }

  return null;
}

export function isCareplusSecretConfigured(businessId: string): boolean {
  return Boolean(getCareplusSecretForBusiness(businessId));
}
