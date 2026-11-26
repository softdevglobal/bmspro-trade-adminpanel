/**
 * The notification stream sends the login token in the Authorization header,
 * never the URL (URLs are written to request logs), and reads events the way
 * EventSource did.
 *
 * Run: npm run test:notification-stream
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  connectBusinessNotificationStream,
  countRefreshEvents,
} from "../lib/notifications/api-client";

describe("countRefreshEvents", () => {
  it("counts refresh events and unnamed messages, not connected events or pings", () => {
    assert.equal(
      countRefreshEvents([
        'event: connected\ndata: {"ok":true}',
        ": ping",
        'event: refresh\ndata: {"at":1}',
        'data: {"at":2}',
        "event: refresh",
      ]),
      3,
    );
  });
});

describe("connectBusinessNotificationStream", () => {
  it("sends the token in a header, handles split chunks and stops on 401", async () => {
    const encoder = new TextEncoder();
    const calls: Array<{ url: string; auth: string | null }> = [];
    let call = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization"),
      });
      call += 1;
      if (call > 1) return new Response("Unauthorized", { status: 401 });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: connected\ndata: {"ok":true}\n\n: ping\n\nevent: ref'));
          controller.enqueue(encoder.encode('resh\ndata: {"at":1}\n\nevent: refresh\ndata: {"at":2}\n\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;

    try {
      let refreshes = 0;
      let tokens = 0;
      const stop = connectBusinessNotificationStream(
        async () => `token-${(tokens += 1)}`,
        () => {
          refreshes += 1;
        },
      );
      // First stream ends, waits 1s, reconnects with a new token, gets 401 and stops.
      await new Promise((resolve) => setTimeout(resolve, 1_300));
      stop();

      assert.equal(refreshes, 2);
      assert.equal(calls.length, 2);
      assert.equal(calls[0].url, "/api/notifications/stream");
      assert.ok(!calls.some((c) => c.url.includes("token")), "token must not be in the URL");
      assert.equal(calls[0].auth, "Bearer token-1");
      assert.equal(calls[1].auth, "Bearer token-2");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
