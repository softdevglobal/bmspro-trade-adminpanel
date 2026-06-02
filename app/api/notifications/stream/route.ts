import {
  createNotificationSseStream,
} from "@/lib/notifications/realtime-hub";
import {
  extractBearerToken,
  requireBusinessOwnerFromToken,
} from "@/lib/notifications/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events push channel for business notifications.
 * Clients refetch GET /api/notifications on `refresh` events (no Firestore listeners).
 */
export async function GET(request: Request) {
  const auth = await requireBusinessOwnerFromToken(extractBearerToken(request));
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  const stream = createNotificationSseStream(
    "business",
    auth.businessId,
    request.signal,
  );

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
