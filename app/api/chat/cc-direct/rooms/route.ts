/**
 * CC direct chat — owner lists and creates chat rooms.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * GET  http://localhost:3000/api/chat/cc-direct/rooms?limit=50
 * POST http://localhost:3000/api/chat/cc-direct/rooms
 * ──────────────────────────────────────────────────────────────────────────────
 * Auth:    Bearer <owner_or_admin_id_token>
 *
 * POST body (queue):   { "queue": true }
 * POST body (direct):  { "agentUid": "agent_firebase_uid" }
 *
 * POST success — 201:  { "ok": true, "room": { "chatId", "queueStatus", ... } }
 * GET success  — 200:  { "ok": true, "rooms": [...] }
 *
 * Firestore: cc_direct_chats/{chatId}
 */

import { requireWorkshopChatUser } from "@/lib/chat/auth";
import { createCcRoom, listCcRoomsForTenant } from "@/lib/chat/ccDirectChat";
import { chatJson, chatOptions } from "@/lib/chat/cors";

export const runtime = "nodejs";

/** CORS preflight. */
export function OPTIONS() {
  return chatOptions();
}

/**
 * GET /api/chat/cc-direct/rooms
 * Lists the owner's CC direct chat threads, newest first.
 */
export async function GET(request: Request) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? "50");
  const rooms = await listCcRoomsForTenant(
    auth.uid,
    Number.isFinite(limit) ? limit : 50,
  );

  return chatJson({ ok: true, rooms });
}

/**
 * POST /api/chat/cc-direct/rooms
 * Opens a shared CC queue request or a deterministic 1:1 room with an agent.
 */
export async function POST(request: Request) {
  const auth = await requireWorkshopChatUser(request);
  if (!auth.ok) {
    return chatJson({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return chatJson({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const queue: boolean =
    !!(
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body as { queue?: unknown }).queue === true
    );
  const agentUid =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as { agentUid?: unknown }).agentUid === "string"
      ? (body as { agentUid: string }).agentUid
      : null;

  try {
    const room = await createCcRoom(auth.uid, { queue, agentUid });
    return chatJson({ ok: true, room }, { status: 201 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not create room.";
    return chatJson({ ok: false, error: msg }, { status: 400 });
  }
}
