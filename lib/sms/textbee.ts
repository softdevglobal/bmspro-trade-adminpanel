import "server-only";

import { releaseSmsCredits, tryConsumeSmsCredits } from "@/lib/sms/usage";

/**
 * textbee.dev SMS gateway client.
 *
 * Sends transactional SMS through a registered Android device. Best-effort:
 * never throws, so notification flows are not blocked when SMS delivery fails
 * or is not configured.
 *
 * When `businessId` is provided, tenant SMS quota is enforced:
 * `smsMessagesUsed` increments on send and delivery is blocked once the limit
 * is reached (`smsMessageLimit`).
 *
 * Required env (server-only):
 *  - TEXTBEE_API_KEY    — API key from the textbee.dev dashboard
 *  - TEXTBEE_DEVICE_ID  — registered device id from the dashboard
 * Optional env:
 *  - TEXTBEE_API_BASE              — defaults to https://api.textbee.dev/api/v1
 *  - TEXTBEE_DEFAULT_COUNTRY_CODE  — E.164 country code for local numbers (default +61)
 *  - TEXTBEE_SIM_SUBSCRIPTION_ID   — SIM slot on multi-SIM phones
 *
 * Note: textbee *webhooks* are for receiving SMS/delivery events. Sending is
 * done via this gateway endpoint (POST .../send-sms).
 */

const DEFAULT_API_BASE = "https://api.textbee.dev/api/v1";

/** Dynamic key lookup — avoids Next.js compile-time inlining of missing env vars. */
function readServerEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

function config() {
  return {
    apiKey: readServerEnv("TEXTBEE_API_KEY"),
    deviceId: readServerEnv("TEXTBEE_DEVICE_ID"),
    apiBase: (readServerEnv("TEXTBEE_API_BASE") || DEFAULT_API_BASE).replace(
      /\/+$/,
      "",
    ),
    defaultCountryCode: readServerEnv("TEXTBEE_DEFAULT_COUNTRY_CODE") || "+61",
    simSubscriptionId: readServerEnv("TEXTBEE_SIM_SUBSCRIPTION_ID") || null,
  };
}

/**
 * Normalises a phone number to E.164 (e.g. +61412345678).
 * Returns null when the number is missing or clearly invalid.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountryCode = "+61",
): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (!value) return null;

  // Already E.164.
  if (value.startsWith("+")) {
    const digits = value.slice(1).replace(/\D/g, "");
    return digits.length >= 6 ? `+${digits}` : null;
  }

  // International prefix "00" → "+".
  if (value.startsWith("00")) {
    const digits = value.slice(2).replace(/\D/g, "");
    return digits.length >= 6 ? `+${digits}` : null;
  }

  const cc = defaultCountryCode.startsWith("+")
    ? defaultCountryCode
    : `+${defaultCountryCode}`;
  const ccDigits = cc.slice(1).replace(/\D/g, "");

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;

  // Local trunk number starting with 0 → strip and prepend country code.
  if (digits.startsWith("0")) {
    const local = digits.replace(/^0+/, "");
    if (local.length < 6) return null;
    return `+${ccDigits}${local}`;
  }

  // Already includes the country code without the leading +.
  if (digits.startsWith(ccDigits)) {
    return `+${digits}`;
  }

  if (digits.length < 6) return null;
  return `+${ccDigits}${digits}`;
}

export type SendSmsInput = {
  /** Recipient phone number in any format; normalised to E.164. */
  to: string | null | undefined;
  /** Message body. */
  message: string;
  /** When set, enforces tenant SMS quota before sending. */
  businessId?: string | null;
};

async function postSmsToGateway(
  recipients: string[],
  message: string,
): Promise<boolean> {
  const cfg = config();
  if (!cfg.apiKey || !cfg.deviceId || recipients.length === 0) {
    return false;
  }

  const url = `${cfg.apiBase}/gateway/devices/${encodeURIComponent(
    cfg.deviceId,
  )}/send-sms`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
    },
    body: JSON.stringify({
      recipients,
      message,
      ...(cfg.simSubscriptionId
        ? { simSubscriptionId: Number(cfg.simSubscriptionId) }
        : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[sms] send FAILED", {
      count: recipients.length,
      status: response.status,
      detail: detail.slice(0, 300),
    });
    return false;
  }

  return true;
}

/**
 * Sends a single SMS. Best-effort — returns false (never throws) when not
 * configured, the number is invalid, quota is exceeded, or delivery fails.
 */
export async function sendSms(input: SendSmsInput): Promise<boolean> {
  const cfg = config();

  if (!cfg.apiKey || !cfg.deviceId) {
    console.warn("[sms] skipped — TEXTBEE not configured.", {
      hasApiKey: Boolean(cfg.apiKey),
      hasDeviceId: Boolean(cfg.deviceId),
    });
    return false;
  }

  const recipient = toE164(input.to, cfg.defaultCountryCode);
  if (!recipient) {
    console.warn("[sms] skipped — no valid recipient phone number.");
    return false;
  }

  const message = input.message?.trim();
  if (!message) {
    console.warn("[sms] skipped — empty message.");
    return false;
  }

  const businessId = input.businessId?.trim() || null;
  if (businessId) {
    const reserved = await tryConsumeSmsCredits(businessId, 1);
    if (!reserved) return false;
  }

  try {
    const sent = await postSmsToGateway([recipient], message);
    if (!sent) {
      if (businessId) await releaseSmsCredits(businessId, 1);
      return false;
    }

    console.log("[sms] sent OK", { to: recipient, businessId });
    return true;
  } catch (error) {
    if (businessId) await releaseSmsCredits(businessId, 1);
    console.error("[sms] send FAILED", { to: recipient, error });
    return false;
  }
}

/**
 * Sends the same SMS to multiple recipients. Best-effort; invalid numbers are
 * skipped. Returns the number of recipients accepted by the gateway.
 */
export async function sendBulkSms(
  recipients: Array<string | null | undefined>,
  message: string,
  businessId?: string | null,
): Promise<number> {
  const cfg = config();
  if (!cfg.apiKey || !cfg.deviceId) {
    console.warn("[sms] bulk skipped — TEXTBEE not configured.");
    return 0;
  }
  const text = message?.trim();
  if (!text) return 0;

  const normalized = Array.from(
    new Set(
      recipients
        .map((r) => toE164(r, cfg.defaultCountryCode))
        .filter((r): r is string => !!r),
    ),
  );
  if (normalized.length === 0) return 0;

  const tenantId = businessId?.trim() || null;
  if (tenantId) {
    const reserved = await tryConsumeSmsCredits(tenantId, normalized.length);
    if (!reserved) return 0;
  }

  try {
    const sent = await postSmsToGateway(normalized, text);
    if (!sent) {
      if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
      return 0;
    }

    console.log("[sms] bulk sent OK", {
      count: normalized.length,
      businessId: tenantId,
    });
    return normalized.length;
  } catch (error) {
    if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
    console.error("[sms] bulk send FAILED", { error });
    return 0;
  }
}
