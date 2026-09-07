import "server-only";

import { createHmac } from "node:crypto";

import {
  getCareplusEndpoints,
  getCareplusSecretForBusiness,
} from "@/lib/integrations/careplus/config";
import {
  CAREPLUS_LEARNING_CANONICAL_PATH,
  CAREPLUS_LEARNING_PREFIX,
  CAREPLUS_MAX_RESPONSE_BYTES,
  CAREPLUS_REQUEST_TIMEOUT_MS,
} from "@/lib/integrations/careplus/constants";
import type {
  CareplusJobCompletedPayload,
  CareplusLearningResult,
  CareplusLearningView,
} from "@/lib/integrations/careplus/types";

export class CareplusClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | null;

  constructor(
    status: number,
    code: string,
    message: string,
    retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "CareplusClientError";
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function userMessageForStatus(status: number): string {
  switch (status) {
    case 401:
      return "CarePlus rejected the signature. Check the per-business secret and BMS business ID.";
    case 403:
      return "CarePlus learning access is disabled for this mapping.";
    case 409:
      return "CarePlus mapping or revision is stale. Recreate the Super Admin mapping.";
    case 413:
      return "CarePlus rejected the page as too large. Use a smaller limit.";
    case 429:
      return "CarePlus rate-limited the request. It will retry automatically.";
    default:
      return status >= 500
        ? "CarePlus is unavailable. The outbox will retry."
        : `CarePlus returned HTTP ${status}.`;
  }
}

async function readCappedJson(
  response: Response,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > CAREPLUS_MAX_RESPONSE_BYTES) {
    throw new CareplusClientError(
      413,
      "response_too_large",
      "CarePlus response exceeded the 256 KB cap.",
    );
  }

  if (buffer.byteLength === 0) {
    return null;
  }

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new CareplusClientError(
      response.status || 502,
      "invalid_content_type",
      "CarePlus did not return JSON.",
    );
  }

  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    throw new CareplusClientError(
      502,
      "invalid_json",
      "CarePlus returned invalid JSON.",
    );
  }
}

function throwIfUnsuccessful(status: number): void {
  if (status >= 200 && status < 300) return;
  throw new CareplusClientError(
    status,
    `http_${status}`,
    userMessageForStatus(status),
  );
}

export async function fetchCareplusLearning(input: {
  businessId: string;
  view: CareplusLearningView;
  limit?: number;
  cursor?: string | null;
  learnerId?: string | null;
}): Promise<CareplusLearningResult> {
  const secret = getCareplusSecretForBusiness(input.businessId);
  if (!secret) {
    throw new CareplusClientError(
      503,
      "secret_missing",
      "No CarePlus secret is configured for this business. Set BMS_NDIS_SECRET for this BMS business ID.",
    );
  }

  const { learningEndpoint } = getCareplusEndpoints();
  const url = new URL(learningEndpoint);
  url.searchParams.set("view", input.view);
  const limit = Math.min(50, Math.max(1, input.limit ?? 25));
  url.searchParams.set("limit", String(limit));
  if (input.cursor?.trim()) {
    url.searchParams.set("cursor", input.cursor.trim());
  }
  if (input.view === "activity" && input.learnerId?.trim()) {
    url.searchParams.set("learnerId", input.learnerId.trim().toLowerCase());
  }

  const timestamp = String(Date.now());
  const message = [
    CAREPLUS_LEARNING_PREFIX,
    "GET",
    `${CAREPLUS_LEARNING_CANONICAL_PATH}${url.search}`,
    input.businessId,
    timestamp,
  ].join("\n");
  const signature = createHmac("sha256", secret).update(message).digest("hex");

  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/json",
      "x-bms-business-id": input.businessId,
      "x-bms-timestamp": timestamp,
      "x-bms-learning-signature": signature,
    },
    signal: AbortSignal.timeout(CAREPLUS_REQUEST_TIMEOUT_MS),
  });

  const body = await readCappedJson(response);
  throwIfUnsuccessful(response.status);

  const nextCursor =
    body &&
    typeof body === "object" &&
    typeof (body as { nextCursor?: unknown }).nextCursor === "string"
      ? (body as { nextCursor: string }).nextCursor
      : null;

  return {
    status: response.status,
    body,
    nextCursor,
  };
}

export async function sendCareplusJobCompleted(input: {
  businessId: string;
  rawBody: string;
}): Promise<{ status: number; retryAfterSeconds: number | null }> {
  const secret = getCareplusSecretForBusiness(input.businessId);
  if (!secret) {
    throw new CareplusClientError(
      503,
      "secret_missing",
      "No CarePlus secret is configured for this business.",
    );
  }

  JSON.parse(input.rawBody) as CareplusJobCompletedPayload;

  const { eventsEndpoint } = getCareplusEndpoints();
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");

  const response = await fetch(eventsEndpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-bms-timestamp": timestamp,
      "x-bms-signature": signature,
    },
    body: input.rawBody,
    signal: AbortSignal.timeout(CAREPLUS_REQUEST_TIMEOUT_MS),
  });

  if (response.status >= 400) {
    const retryAfter = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    throw new CareplusClientError(
      response.status,
      response.status === 429 ? "rate_limited" : `http_${response.status}`,
      userMessageForStatus(response.status),
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }

  return { status: response.status, retryAfterSeconds: null };
}

export function retryAfterSecondsFromError(error: unknown): number | null {
  return error instanceof CareplusClientError
    ? error.retryAfterSeconds
    : null;
}
