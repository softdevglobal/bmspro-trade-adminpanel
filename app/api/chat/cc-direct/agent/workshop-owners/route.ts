/**
 * CC direct chat — agent lists workshop owners to contact.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET http://localhost:3000/api/chat/cc-direct/agent/workshop-owners
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    none
 *
 * Success — 200:
 *   { "ok": true, "owners": [{ "uid", "fullName", "email", "businessId" }] }
 *
 * Use uid with: POST /api/chat/cc-direct/agent/start-with-owner
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { listWorkshopOwnersForAgent } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/agent/workshop-owners
 * Picker list for agents who want to proactively start a chat with an owner.
 */
export async function GET(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const owners = await listWorkshopOwnersForAgent();
  return chatJson({ ok: true, owners });
}
