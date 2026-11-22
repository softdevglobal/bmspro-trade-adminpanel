/**
 * GET ?view=inbox|sent|starred|archive|trash&cursor=&q= — the business's
 * mailbox, newest first, plus sync/import status. With `q`, the provider's own
 * search runs across the whole mailbox.
 */

import { encryptJson, decryptJson } from "@/lib/email-integration/crypto";
import { emailError } from "@/lib/email-integration/auth";
import { importMessages } from "@/lib/email-integration/mailbox/sync";
import { requireMailbox } from "@/lib/email-integration/mailbox/access";
import {
  getStoredMessagesByProviderIds,
  getSyncStatus,
  listMailboxMessages,
} from "@/lib/email-integration/mailbox/store";
import type { MailboxView } from "@/lib/email-integration/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEWS: MailboxView[] = ["inbox", "sent", "starred", "archive", "trash"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().slice(0, 200) ?? "";
  const gate = await requireMailbox(request, { capability: "read", credentials: Boolean(q) });
  if (!gate.ok) return gate.response;

  const status = await getSyncStatus(gate.connection.id);

  const pageSize = 5;
  if (q) {
    let token: string | null = null;
    const cursor = searchParams.get("cursor");
    if (cursor) {
      try {
        const saved = decryptJson<{ connection: string; query: string; token: string }>(cursor);
        if (saved.connection !== gate.connection.id || saved.query !== q || typeof saved.token !== "string") {
          return emailError(400, "Invalid search cursor.");
        }
        token = saved.token;
      } catch {
        return emailError(400, "Invalid search cursor.");
      }
    }
    try {
      const page = await gate.adapter.searchPage(gate.credentials!, { kind: "text", text: q }, token, pageSize);
      const ids = page.ids;
      // Hits the background import hasn't reached yet are imported now.
      await importMessages(gate.connection, gate.credentials!, ids, page.prefetched);
      const items = await getStoredMessagesByProviderIds(gate.connection.id, ids);
      return NextResponse.json({ ok: true, items, nextCursor: page.nextPageToken ? encryptJson({ connection: gate.connection.id, query: q, token: page.nextPageToken }) : null, status });
    } catch {
      return emailError(502, "Search isn't available right now. Try again.");
    }
  }

  const requested = searchParams.get("view") ?? searchParams.get("folder") ?? "inbox";
  const view = VIEWS.includes(requested as MailboxView) ? (requested as MailboxView) : "inbox";
  const page = await listMailboxMessages({
    connectionId: gate.connection.id,
    view,
    limit: pageSize,
    linkedOnly: searchParams.get("linked") === "1",
    cursor: searchParams.get("cursor")?.trim() || null,
  });
  return NextResponse.json({ ok: true, ...page, status });
}
