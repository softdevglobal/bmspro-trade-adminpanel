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
  /** Display name for the sending tenant (resolved from business when omitted). */
  senderName?: string | null;
  /** Optional recipient display name. */
  receiverName?: string | null;
  /** Short label for why the SMS was sent (e.g. quotation_sent). */
  source?: string | null;
};

type SmsLogContext = {
  businessId: string | null;
  senderName: string | null;
  receiverName: string | null;
  source: string | null;
  message: string;
  rawTo: string | null | undefined;
};

async function recordSmsLog(
  ctx: SmsLogContext,
  receiverPhone: string,
  status: "sent" | "failed" | "skipped",
  statusDetail: string,
): Promise<void> {
  const { appendSmsLog } = await import("@/lib/sms/sms-log-server");
  await appendSmsLog({
    businessId: ctx.businessId,
    senderName: ctx.senderName,
    receiverPhone,
    receiverName: ctx.receiverName,
    message: ctx.message,
    status,
    statusDetail,
    source: ctx.source,
  });
}

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
  const businessId = input.businessId?.trim() || null;
  const message = input.message?.trim() ?? "";
  const logCtx: SmsLogContext = {
    businessId,
    senderName: input.senderName ?? null,
    receiverName: input.receiverName ?? null,
    source: input.source ?? null,
    message,
    rawTo: input.to,
  };

  if (!cfg.apiKey || !cfg.deviceId) {
    console.warn("[sms] skipped — TEXTBEE not configured.", {
      hasApiKey: Boolean(cfg.apiKey),
      hasDeviceId: Boolean(cfg.deviceId),
    });
    await recordSmsLog(
      logCtx,
      input.to?.trim() || "—",
      "skipped",
      "gateway_not_configured",
    );
    return false;
  }

  const recipient = toE164(input.to, cfg.defaultCountryCode);
  if (!recipient) {
    console.warn("[sms] skipped — no valid recipient phone number.");
    await recordSmsLog(
      logCtx,
      input.to?.trim() || "—",
      "skipped",
      "invalid_recipient",
    );
    return false;
  }

  if (!message) {
    console.warn("[sms] skipped — empty message.");
    await recordSmsLog(logCtx, recipient, "skipped", "empty_message");
    return false;
  }

  if (businessId) {
    const reserved = await tryConsumeSmsCredits(businessId, 1);
    if (!reserved) {
      await recordSmsLog(logCtx, recipient, "skipped", "quota_exceeded");
      return false;
    }
  }

  try {
    const sent = await postSmsToGateway([recipient], message);
    if (!sent) {
      if (businessId) await releaseSmsCredits(businessId, 1);
      await recordSmsLog(logCtx, recipient, "failed", "gateway_rejected");
      return false;
    }

    console.log("[sms] sent OK", { to: recipient, businessId });
    await recordSmsLog(logCtx, recipient, "sent", "delivered");
    return true;
  } catch (error) {
    if (businessId) await releaseSmsCredits(businessId, 1);
    console.error("[sms] send FAILED", { to: recipient, error });
    await recordSmsLog(logCtx, recipient, "failed", "gateway_error");
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
  meta?: {
    senderName?: string | null;
    source?: string | null;
  },
): Promise<number> {
  const cfg = config();
  const text = message?.trim() ?? "";
  const tenantId = businessId?.trim() || null;
  const logBase = {
    businessId: tenantId,
    senderName: meta?.senderName ?? null,
    receiverName: null as string | null,
    source: meta?.source ?? null,
    message: text,
  };

  if (!cfg.apiKey || !cfg.deviceId) {
    console.warn("[sms] bulk skipped — TEXTBEE not configured.");
    for (const raw of recipients) {
      await recordSmsLog(
        { ...logBase, rawTo: raw },
        raw?.trim() || "—",
        "skipped",
        "gateway_not_configured",
      );
    }
    return 0;
  }
  if (!text) return 0;

  const normalized = Array.from(
    new Set(
      recipients
        .map((r) => toE164(r, cfg.defaultCountryCode))
        .filter((r): r is string => !!r),
    ),
  );
  if (normalized.length === 0) {
    for (const raw of recipients) {
      await recordSmsLog(
        { ...logBase, rawTo: raw },
        raw?.trim() || "—",
        "skipped",
        "invalid_recipient",
      );
    }
    return 0;
  }

  if (tenantId) {
    const reserved = await tryConsumeSmsCredits(tenantId, normalized.length);
    if (!reserved) {
      for (const phone of normalized) {
        await recordSmsLog(
          { ...logBase, rawTo: phone },
          phone,
          "skipped",
          "quota_exceeded",
        );
      }
      return 0;
    }
  }

  try {
    const sent = await postSmsToGateway(normalized, text);
    if (!sent) {
      if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
      for (const phone of normalized) {
        await recordSmsLog(
          { ...logBase, rawTo: phone },
          phone,
          "failed",
          "gateway_rejected",
        );
      }
      return 0;
    }

    console.log("[sms] bulk sent OK", {
      count: normalized.length,
      businessId: tenantId,
    });
    for (const phone of normalized) {
      await recordSmsLog(
        { ...logBase, rawTo: phone },
        phone,
        "sent",
        "delivered",
      );
    }
    return normalized.length;
  } catch (error) {
    if (tenantId) await releaseSmsCredits(tenantId, normalized.length);
    console.error("[sms] bulk send FAILED", { error });
    for (const phone of normalized) {
      await recordSmsLog(
        { ...logBase, rawTo: phone },
        phone,
        "failed",
        "gateway_error",
      );
    }
    return 0;
  }
}
