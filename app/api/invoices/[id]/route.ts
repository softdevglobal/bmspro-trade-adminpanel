import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { logAuditEvent } from "@/lib/audit/server";
import { deleteBusinessInvoice } from "@/lib/invoices/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function requireInvoiceAuthor(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return {
      ok: false as const,
      status: 401,
      error: "Missing authorization header.",
    };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    let businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    let role = typeof decoded.role === "string" ? decoded.role : null;
    let name = typeof decoded.name === "string" ? decoded.name : null;

    if (!businessId || !role) {
      const userSnap = await adminDb.collection("users").doc(decoded.uid).get();
      if (userSnap.exists) {
        const data = userSnap.data() ?? {};
        if (!businessId && typeof data.businessId === "string") {
          businessId = data.businessId;
        }
        if (!role && typeof data.role === "string") {
          role = data.role;
        }
        if (!name && typeof data.fullName === "string") {
          name = data.fullName;
        }
      }
    }

    if (role === "business_owner") role = "owner";

    if (
      !businessId ||
      (role !== "staff" && role !== "owner" && role !== "admin")
    ) {
      return {
        ok: false as const,
        status: 403,
        error: "You do not have permission to delete invoices.",
      };
    }

    return {
      ok: true as const,
      uid: decoded.uid,
      email: decoded.email ?? null,
      name,
      role,
      businessId,
    };
  } catch {
    return {
      ok: false as const,
      status: 401,
      error: "Invalid or expired session.",
    };
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireInvoiceAuthor(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await deleteBusinessInvoice(auth.businessId, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "invoice",
    action: "invoice.deleted",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: auth.name,
      email: auth.email,
    },
    source: "admin_panel",
    summary: `Invoice ${result.invoice.invoiceCode} deleted`,
    targetId: result.invoice.id,
    targetLabel: result.invoice.invoiceCode || null,
    metadata: {
      invoiceCode: result.invoice.invoiceCode,
      quotationCode: result.invoice.quotationCode,
      status: result.invoice.status,
    },
  });

  return NextResponse.json({ ok: true });
}
