import { logAuditEvent } from "@/lib/audit/server";
import { actorRoleFromClaim } from "@/lib/audit/types";
import { adminAuth } from "@/lib/firebase/admin";
import {
  listCatalogItems,
  parseCatalogItemInput,
  upsertCatalogItem,
} from "@/lib/items/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ItemAuth =
  | { ok: true; uid: string; businessId: string; role: string }
  | { ok: false; status: number; error: string };

/** Verifies the bearer token and returns the caller's business + role. */
async function authenticate(
  request: Request,
  allowedRoles: string[],
): Promise<ItemAuth> {
  const authHeader = request.headers.get("authorization") ?? "";
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    const businessId =
      typeof decoded.businessId === "string" ? decoded.businessId : null;
    const role = typeof decoded.role === "string" ? decoded.role : "";
    if (!businessId || !allowedRoles.includes(role)) {
      return {
        ok: false,
        status: 403,
        error: "You do not have permission to manage items.",
      };
    }
    return { ok: true, uid: decoded.uid, businessId, role };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired session." };
  }
}

/** Lists the item catalog — readable by owners, admins and staff. */
export async function GET(request: Request) {
  const auth = await authenticate(request, ["owner", "admin", "staff"]);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const items = await listCatalogItems(auth.businessId);
  return NextResponse.json({ ok: true, items });
}

/** Creates or updates a catalog item — owners and admins only. */
export async function POST(request: Request) {
  const auth = await authenticate(request, ["owner", "admin"]);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

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

  const item = await upsertCatalogItem(auth.businessId, auth.uid, input);

  await logAuditEvent({
    businessId: auth.businessId,
    category: "item",
    action: "item.created",
    actor: {
      uid: auth.uid,
      role: actorRoleFromClaim(auth.role),
      name: null,
      email: null,
    },
    source: "admin_panel",
    summary: `Catalog item "${item.name}" added`,
    targetId: item.id,
    targetLabel: item.name,
    metadata: { priceAud: item.priceAud, code: item.code ?? null },
  });

  return NextResponse.json({ ok: true, item }, { status: 201 });
}
