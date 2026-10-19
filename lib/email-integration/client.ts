"use client";

import { useAuth } from "@/lib/auth/auth-context";
import type {
  EmailConnectionSummary,
  EmailOutboxStatus,
} from "@/lib/email-integration/types";
import { useCallback, useEffect, useState } from "react";

type AuthUser = { getIdToken: () => Promise<string> };

export class EmailApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(message);
  }
}

/** Authenticated JSON call to the email API; throws EmailApiError on failure. */
export async function emailApi<T>(
  user: AuthUser,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await user.getIdToken();
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    code?: string;
  } & T;
  if (!response.ok || payload.ok === false) {
    throw new EmailApiError(
      payload.error ?? "Something went wrong. Please try again.",
      response.status,
      payload.code ?? null,
    );
  }
  return payload;
}

export type EmailSendingState = {
  loading: boolean;
  enabled: boolean;
  providers: string[];
  connection: EmailConnectionSummary | null;
  reload: () => Promise<void>;
};

/**
 * Whether business-mailbox sending is on, and the current connection. Pass
 * `skip` for viewers who can never send (it then reports disabled without
 * calling the API).
 */
export function useEmailSending(options: { skip?: boolean } = {}): EmailSendingState {
  const skip = options.skip === true;
  const { user } = useAuth();
  const [state, setState] = useState<Omit<EmailSendingState, "reload">>({
    loading: true,
    enabled: false,
    providers: [],
    connection: null,
  });

  const reload = useCallback(async () => {
    if (!user || skip) {
      setState({ loading: false, enabled: false, providers: [], connection: null });
      return;
    }
    try {
      const payload = await emailApi<{
        enabled: boolean;
        providers: string[];
        connection: EmailConnectionSummary | null;
      }>(user, "/api/email/connections");
      setState({
        loading: false,
        enabled: payload.enabled,
        providers: payload.providers ?? [],
        connection: payload.connection,
      });
    } catch {
      // Staff without owner access, or the feature is off: hide email UI.
      setState({ loading: false, enabled: false, providers: [], connection: null });
    }
  }, [user, skip]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (active) await reload();
    })();
    return () => {
      active = false;
    };
  }, [reload]);

  return { ...state, reload };
}

export const PENDING_EMAIL_STATUSES: EmailOutboxStatus[] = [
  "queued",
  "sending",
  "retry_wait",
];

/** Plain-language status. "Accepted" never claims delivery or reading. */
export function emailStatusLabel(status: EmailOutboxStatus): string {
  switch (status) {
    case "queued":
      return "Queued — sending shortly";
    case "sending":
      return "Sending…";
    case "retry_wait":
      return "Waiting to retry";
    case "accepted":
      return "Accepted by email provider";
    case "failed":
      return "Not sent";
    case "blocked_auth":
      return "Mailbox needs reconnecting";
    case "unknown":
      return "Outcome unknown — check your Sent folder";
    case "held":
      return "On hold";
    case "cancelled":
      return "Cancelled";
  }
}

export function emailStatusTone(status: EmailOutboxStatus): string {
  switch (status) {
    case "accepted":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "failed":
    case "blocked_auth":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "unknown":
    case "held":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-primary/20 bg-primary/5 text-primary";
  }
}
