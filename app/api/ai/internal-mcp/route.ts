import { draftAcceptedQuotationInvoice } from "@/lib/ai/mcp/tools/invoice.tools";
import { listOverdueInvoices, notifyOverdueInvoice } from "@/lib/ai/mcp/tools/overdue-invoice.tools";
import { requireBusinessMember } from "@/lib/onboarding/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireBusinessMember(request);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  if (auth.role !== "owner" && auth.role !== "admin") {
    return Response.json({ error: "Invoice tools require business owner or admin access." }, { status: 403 });
  }

  const server = new McpServer({ name: "bmspro-trade-internal", version: "1.0.0" });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true, maxRequestBodySize: 16_384 });
  server.tool(
    "list_overdue_invoices",
    "List issued, unpaid invoices past their due date for this business. Follow nextCursor even if a page contains no overdue invoices. This tool does not send reminders.",
    { cursor: z.string().regex(/^[\w-]{1,128}$/).optional() },
    async ({ cursor }) => ({
      content: [{ type: "text", text: JSON.stringify(await listOverdueInvoices(auth, cursor)) }],
    }),
  );
  server.tool(
    "notify_overdue_invoice",
    "Email the customer and business owner for one invoice found by list_overdue_invoices. Trade rechecks the balance and due date and attempts at most one email per recipient per business day. Report each recipient's status separately. If UNCONFIRMED, ask staff to verify delivery.",
    { invoiceId: z.string().regex(/^[\w-]{1,128}$/) },
    async ({ invoiceId }) => ({
      content: [{ type: "text", text: JSON.stringify(await notifyOverdueInvoice(auth, invoiceId)) }],
    }),
  );
  server.tool(
    "draft_accepted_quotation_invoice",
    "Create one unsent draft invoice for a customer-accepted quotation in this business. Use the saved quotation ID. Trade copies the approved prices and preserves any existing invoice.",
    { quotationId: z.string().regex(/^[\w-]{1,128}$/) },
    async ({ quotationId }) => {
      try {
        const result = await draftAcceptedQuotationInvoice(auth.businessId, quotationId);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch {
        return { isError: true, content: [{ type: "text", text: JSON.stringify({
          status: "UNKNOWN", message: "Check for an existing invoice in Trade.",
        }) }] };
      }
    },
  );
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.status === 202 || response.status === 204 ? null : body, { status: response.status, headers });
  } finally {
    await server.close();
  }
}
