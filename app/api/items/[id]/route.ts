import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { adminAuth } from "@/lib/firebase/admin";
import {
  deleteCatalogItem,
  parseCatalogItemInput,
  updateCatalogItem,
} from "@/lib/items/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ItemAuth =
  | { ok: true; uid: string; businessId: string; role: string | null }
  | { ok: false; status: number; error: string };

async function requireItemManager(request: Request): Promise<ItemAuth> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = decoded.role;
    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false,
        status: 403,
        error: "You do not have permission to manage items.",
      };
    }
    return {
      ok: true,
      uid: decoded.uid,
      businessId,
      role: typeof role === "string" ? role : null,
    };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireItemManager(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const input = parseCatalogItemInput(body);
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "Provide a valid item name and price." },
      { status: 400 },
    );
  }

  const result = await updateCatalogItem(auth.businessId, id, input);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "item",
    action: "item.updated",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: null,
      email: null,
    },
    source: "admin_panel",
    summary: `Catalog item "${result.item.name}" updated`,
    targetId: id,
    targetLabel: result.item.name,
    metadata: { priceAud: result.item.priceAud, code: result.item.code ?? null },
  });

  return NextResponse.json({ ok: true, item: result.item });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireItemManager(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const { id } = await context.params;
  const result = await deleteCatalogItem(auth.businessId, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status },
    );
  }

  await logAuditEvent({
    businessId: auth.businessId,
    category: "item",
    action: "item.deleted",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: null,
      email: null,
    },
    source: "admin_panel",
    summary: `Catalog item removed`,
    targetId: id,
    targetLabel: null,
    metadata: {},
  });

  return NextResponse.json({ ok: true });
}
