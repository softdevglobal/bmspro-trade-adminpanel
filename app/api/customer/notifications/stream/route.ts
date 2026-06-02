import { authenticateCustomerRequest } from "@/lib/customer/server";
import { createNotificationSseStream } from "@/lib/notifications/realtime-hub";
import { extractBearerToken } from "@/lib/notifications/auth-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SSE push for customer notifications (booking portal). */
export async function GET(request: Request) {
  const token = extractBearerToken(request);
  if (!token) {
    return new Response("Missing authorization token.", { status: 401 });
  }

  const auth = await authenticateCustomerRequest(
    new Request(request.url, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
  if (!auth.ok) {
    return new Response(auth.error, { status: auth.status });
  }

  const stream = createNotificationSseStream(
    "customer",
    auth.customer.uid,
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
