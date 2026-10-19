import "server-only";

import {
  loadCredentials,
  storeCredentials,
  type EmailConnectionRecord,
} from "@/lib/email-integration/connections";
import { getEmailAdapter } from "@/lib/email-integration/providers";
import type { ProviderCredentials } from "@/lib/email-integration/providers/types";

/**
 * Credentials with a usable access token, refreshing and re-storing them when
 * they are about to expire. `authFailure` means the owner must reconnect.
 */
export async function freshCredentials(
  connection: EmailConnectionRecord,
): Promise<
  | { ok: true; credentials: ProviderCredentials }
  | { ok: false; authFailure: boolean; code: string }
> {
  const adapter = getEmailAdapter(connection.provider);
  const stored = await loadCredentials(connection).catch(() => null);
  if (!adapter || !stored) {
    return { ok: false, authFailure: true, code: "credentials_missing" };
  }
  if (stored.accessTokenExpiresAt - Date.now() > 60_000) {
    return { ok: true, credentials: stored };
  }
  const refreshed = await adapter.refresh(stored);
  if (!refreshed.ok) return refreshed;
  await storeCredentials(connection, refreshed.credentials);
  return { ok: true, credentials: refreshed.credentials };
}
