/**
 * CC direct chat — agent starts a conversation with a workshop owner.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * POST http://localhost:3000/api/chat/cc-direct/agent/start-with-owner
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <call_center_agent_id_token>
 * Body:    { "workshopOwnerUid": "owner_firebase_uid", "text": "Hello" }
 *
 * Success — 201:  { "ok": true, "room": { "chatId", ... } }
 * Errors:         400 if workshopOwnerUid missing
 *
 * Firestore: cc_direct_chats/cc_{sortedUidA}_{sortedUidB}
 */

import { requireCallCenterAgent } from "@/lib/chat/auth";
import { startChatWithOwner } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * POST /api/chat/cc-direct/agent/start-with-owner
 * Creates or reopens a 1:1 CC room and optionally sends the first message.
 */
export async function POST(request: Request) {
  const auth = await requireCallCenterAgent(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return chatJson({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const workshopOwnerUid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { workshopOwnerUid?: unknown }).workshopOwnerUid === "string"
      ? (body as { workshopOwnerUid: string }).workshopOwnerUid.trim()
      : "";
  const text =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { text?: unknown }).text === "string"
      ? (body as { text: string }).text
      : null;

  if (!workshopOwnerUid) {
    return chatJson(
      { ok: false, error: "workshopOwnerUid is required." },
      { status: 400 },
    );
  }

  try {
    const room = await startChatWithOwner(auth.uid, workshopOwnerUid, text);
    return chatJson({ ok: true, room }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not start chat.";
    return chatJson({ ok: false, error: msg }, { status: 400 });
  }
}
