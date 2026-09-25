import "server-only";
import { timingSafeEqual } from "node:crypto";

const HEADER = "x-command-center-ai-key";

/**
 * Authenticates the Command Center AI receptionist service principal.
 *
 * The AI never uses a human agent's Firebase session. Command Center's backend
 * sends a shared service key (`COMMAND_CENTER_AI_SERVICE_KEY`) and a
 * server-resolved `businessId`; the caller, transcript and model cannot change
 * either. Unset key → the AI API is disabled (fail closed).
 */
export function requireCommandCenterAiService(
  req: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const expected = process.env.COMMAND_CENTER_AI_SERVICE_KEY?.trim() ?? "";
  if (expected.length < 32) {
    return {
      ok: false,
      status: 503,
      error: "Command Center AI access is not configured.",
    };
  }

  const provided = req.headers.get(HEADER)?.trim() ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Invalid service credentials." };
  }
  return { ok: true };
}
