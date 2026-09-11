import "server-only";

import { createHmac } from "node:crypto";

import {
  getCareplusEndpoints,
  getCareplusSecretForBusiness,
} from "@/lib/integrations/careplus/config";
import {
  CAREPLUS_BMS_DIRECTORY_CANONICAL_PATH,
  CAREPLUS_BMS_DIRECTORY_PREFIX,
  CAREPLUS_LEARNING_CANONICAL_PATH,
  CAREPLUS_LEARNING_PREFIX,
  CAREPLUS_MAX_RESPONSE_BYTES,
  CAREPLUS_REQUEST_TIMEOUT_MS,
} from "@/lib/integrations/careplus/constants";
import type {
  CareplusDirectoryPerson,
  CareplusJobCompletedPayload,
  CareplusLearningResult,
  CareplusLearningView,
  CareplusReceipt,
  CareplusReceiptCorrection,
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
      return "Check the CarePlus secret. With BMS_CAREPLUS_MASTER_SECRET, Trade derives each business key automatically.";
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
      "No CarePlus secret is configured for this business. Set BMS_CAREPLUS_MASTER_SECRET (same value as CarePlus BMS_WEBHOOK_SECRET) or a per-business BMS_NDIS_SECRET.",
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

function parseDirectoryPeople(body: unknown): CareplusDirectoryPerson[] {
  if (!body || typeof body !== "object") return [];
  const rows = Array.isArray((body as { records?: unknown }).records)
    ? ((body as { records: unknown[] }).records)
    : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) return [];
    const email =
      typeof item.email === "string" && item.email.trim()
        ? item.email.trim().toLowerCase()
        : "";
    const bmsStaffId =
      typeof item.bmsStaffId === "string" ? item.bmsStaffId.trim() : "";
    const bmsCustomerId =
      typeof item.bmsCustomerId === "string" ? item.bmsCustomerId.trim() : "";
    return [
      {
        id,
        name:
          typeof item.name === "string" && item.name.trim()
            ? item.name.trim()
            : id,
        ...(email ? { email } : {}),
        ...(bmsStaffId ? { bmsStaffId } : {}),
        ...(bmsCustomerId ? { bmsCustomerId } : {}),
      },
    ];
  });
}

export async function fetchCareplusDirectory(input: {
  businessId: string;
  view: "staff" | "participants";
}): Promise<CareplusDirectoryPerson[]> {
  const secret = getCareplusSecretForBusiness(input.businessId);
  if (!secret) {
    throw new CareplusClientError(
      503,
      "secret_missing",
      "No CarePlus secret is configured for this business.",
    );
  }

  const { directoryListEndpoint } = getCareplusEndpoints();
  const url = new URL(directoryListEndpoint);
  url.searchParams.set("view", input.view);
  const timestamp = String(Date.now());
  const message = [
    CAREPLUS_BMS_DIRECTORY_PREFIX,
    "GET",
    `${CAREPLUS_BMS_DIRECTORY_CANONICAL_PATH}${url.search}`,
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
      "x-bms-directory-signature": signature,
    },
    signal: AbortSignal.timeout(CAREPLUS_REQUEST_TIMEOUT_MS),
  });

  const body = await readCappedJson(response);
  throwIfUnsuccessful(response.status);
  return parseDirectoryPeople(body);
}

function parseReceipt(body: unknown): CareplusReceipt | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const receipt =
    root.receipt && typeof root.receipt === "object"
      ? (root.receipt as Record<string, unknown>)
      : root;
  if (typeof receipt.eventId !== "string") return null;
  const corrections = Array.isArray(receipt.corrections)
    ? receipt.corrections.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.message !== "string") return [];
        const correction: CareplusReceiptCorrection = {
          field: typeof row.field === "string" ? row.field : "record",
          message: row.message,
        };
        return [correction];
      })
    : [];
  return {
    eventId: receipt.eventId,
    status: typeof receipt.status === "string" ? receipt.status : "",
    careplusRecordId:
      typeof receipt.careplusRecordId === "string" ? receipt.careplusRecordId : "",
    careplusResource:
      typeof receipt.careplusResource === "string" ? receipt.careplusResource : "",
    errors: Array.isArray(receipt.errors)
      ? receipt.errors.filter((item): item is string => typeof item === "string")
      : [],
    corrections,
  };
}

export type CareplusSendResult = {
  status: number;
  retryAfterSeconds: number | null;
  receipt: CareplusReceipt | null;
};

function errorDetailFromBody(body: unknown): { code: string | null; message: string | null } {
  if (!body || typeof body !== "object") return { code: null, message: null };
  const record = body as Record<string, unknown>;
  const nested =
    record.error && typeof record.error === "object"
      ? (record.error as Record<string, unknown>)
      : null;
  const codeCandidate = nested?.code ?? record.code ?? record.errorCode;
  const messageCandidate =
    nested?.message ?? record.message ?? (typeof record.error === "string" ? record.error : null);
  return {
    code: typeof codeCandidate === "string" && codeCandidate.trim() ? codeCandidate.trim() : null,
    message:
      typeof messageCandidate === "string" && messageCandidate.trim()
        ? messageCandidate.trim().slice(0, 180)
        : null,
  };
}

function eventTimestampMs(): string {
  return String(Date.now());
}

function signEventPayload(secret: string, timestamp: string, payload: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
}

async function signedCareplusPost(input: {
  businessId: string;
  rawBody: string;
  endpoint: string;
}): Promise<CareplusSendResult> {
  const secret = getCareplusSecretForBusiness(input.businessId);
  if (!secret) {
    throw new CareplusClientError(
      503,
      "secret_missing",
      "No CarePlus secret is configured for this business.",
    );
  }

  JSON.parse(input.rawBody);

  // Same millisecond clock as CarePlus learning. Unix seconds fail their window
  // even when the HMAC key is correct.
  const timestamp = eventTimestampMs();
  const signature = signEventPayload(secret, timestamp, input.rawBody);

  const response = await fetch(input.endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-bms-business-id": input.businessId,
      "x-bms-timestamp": timestamp,
      "x-bms-signature": signature,
    },
    body: input.rawBody,
    signal: AbortSignal.timeout(CAREPLUS_REQUEST_TIMEOUT_MS),
  });

  const body = await readCappedJson(response).catch(() => null);

  if (response.status >= 400) {
    const retryAfter = Number.parseInt(
      response.headers.get("retry-after") ?? "",
      10,
    );
    const detail = errorDetailFromBody(body);
    console.error("[careplus] POST rejected", {
      status: response.status,
      businessId: input.businessId,
      code: detail.code,
      message: detail.message,
    });
    throw new CareplusClientError(
      response.status,
      detail.code ||
        (response.status === 429 ? "rate_limited" : `http_${response.status}`),
      detail.message || userMessageForStatus(response.status),
      Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }

  return {
    status: response.status,
    retryAfterSeconds: null,
    receipt: parseReceipt(body),
  };
}

export async function sendCareplusJobCompleted(input: {
  businessId: string;
  rawBody: string;
}): Promise<CareplusSendResult> {
  JSON.parse(input.rawBody) as CareplusJobCompletedPayload;
  const { eventsEndpoint } = getCareplusEndpoints();
  return signedCareplusPost({ ...input, endpoint: eventsEndpoint });
}

export async function sendCareplusRecord(input: {
  businessId: string;
  rawBody: string;
}): Promise<CareplusSendResult> {
  const { recordsEndpoint } = getCareplusEndpoints();
  return signedCareplusPost({ ...input, endpoint: recordsEndpoint });
}

export async function fetchCareplusReceipt(input: {
  businessId: string;
  eventId: string;
}): Promise<CareplusReceipt> {
  const secret = getCareplusSecretForBusiness(input.businessId);
  if (!secret) {
    throw new CareplusClientError(
      503,
      "secret_missing",
      "No CarePlus secret is configured for this business.",
    );
  }
  const { recordsEndpoint } = getCareplusEndpoints();
  const url = new URL(recordsEndpoint);
  url.searchParams.set("eventId", input.eventId);
  const timestamp = eventTimestampMs();
  const signature = signEventPayload(secret, timestamp, input.eventId);
  const response = await fetch(url, {
    method: "GET",
    redirect: "error",
    headers: {
      accept: "application/json",
      "x-bms-business-id": input.businessId,
      "x-bms-timestamp": timestamp,
      "x-bms-signature": signature,
    },
    signal: AbortSignal.timeout(CAREPLUS_REQUEST_TIMEOUT_MS),
  });
  const body = await readCappedJson(response);
  throwIfUnsuccessful(response.status);
  const receipt = parseReceipt(body);
  if (!receipt) {
    throw new CareplusClientError(502, "invalid_receipt", "CarePlus returned no receipt.");
  }
  return receipt;
}

export function retryAfterSecondsFromError(error: unknown): number | null {
  return error instanceof CareplusClientError
    ? error.retryAfterSeconds
    : null;
}
