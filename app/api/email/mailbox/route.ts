/**
 * GET ?view=inbox|sent|starred|archive|trash&cursor=&q= — the business's
 * mailbox, newest first, plus sync/import status. With `q`, Gmail's own search
 * runs across the whole mailbox.
 */

import { emailError } from "@/lib/email-integration/auth";
import { searchMessageIds } from "@/lib/email-integration/mailbox/gmail";
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

  if (q) {
    try {
      const ids = await searchMessageIds(gate.credentials!, q, 50);
      // Hits the background import hasn't reached yet are imported now.
      await importMessages(gate.connection, gate.credentials!, ids);
      const items = await getStoredMessagesByProviderIds(gate.connection.id, ids);
      return NextResponse.json({ ok: true, items, nextCursor: null, status });
    } catch {
      return emailError(502, "Search isn't available right now. Try again.");
    }
  }

  const requested = searchParams.get("view") ?? searchParams.get("folder") ?? "inbox";
  const view = VIEWS.includes(requested as MailboxView) ? (requested as MailboxView) : "inbox";
  const page = await listMailboxMessages({
    connectionId: gate.connection.id,
    view,
    linkedOnly: searchParams.get("linked") === "1",
    cursor: searchParams.get("cursor")?.trim() || null,
  });
  return NextResponse.json({ ok: true, ...page, status });
}
