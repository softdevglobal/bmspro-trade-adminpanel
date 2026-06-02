import "server-only";

type SseController = ReadableStreamDefaultController<Uint8Array>;

const encoder = new TextEncoder();

function sseChunk(event: string, data: unknown): Uint8Array {
  return encoder.encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

/** In-process pub/sub for notification SSE streams (one push per server instance). */
class NotificationRealtimeHub {
  private channels = new Map<string, Set<SseController>>();

  private channelKey(audience: "business" | "customer", id: string): string {
    return `${audience}:${id}`;
  }

  subscribe(
    audience: "business" | "customer",
    id: string,
    controller: SseController,
  ): () => void {
    const key = this.channelKey(audience, id);
    let set = this.channels.get(key);
    if (!set) {
      set = new Set();
      this.channels.set(key, set);
    }
    set.add(controller);
    return () => {
      set.delete(controller);
      if (set.size === 0) this.channels.delete(key);
    };
  }

  /** Tells connected clients to refetch via GET (avoids shipping full lists over SSE). */
  notifyRefresh(audience: "business" | "customer", id: string): void {
    const set = this.channels.get(this.channelKey(audience, id));
    if (!set?.size) return;
    const chunk = sseChunk("refresh", { at: Date.now() });
    for (const controller of set) {
      try {
        controller.enqueue(chunk);
      } catch {
        /* client disconnected */
      }
    }
  }
}

export const notificationRealtimeHub = new NotificationRealtimeHub();

export function notifyBusinessNotificationsChanged(businessId: string): void {
  notificationRealtimeHub.notifyRefresh("business", businessId);
}

export function notifyCustomerNotificationsChanged(customerId: string): void {
  notificationRealtimeHub.notifyRefresh("customer", customerId);
}

export function createNotificationSseStream(
  audience: "business" | "customer",
  id: string,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const unsubscribe = notificationRealtimeHub.subscribe(
        audience,
        id,
        controller,
      );
      controller.enqueue(sseChunk("connected", { ok: true }));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      signal.addEventListener("abort", close, { once: true });
    },
  });
}
