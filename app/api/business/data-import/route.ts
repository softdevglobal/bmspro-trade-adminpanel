import type { ExportDatasetKey } from "@/lib/export/business-data";
import { IMPORT_MAX_ROWS } from "@/lib/export/import-shared";
import { importBusinessDataset } from "@/lib/export/import-server";
import type { ExportRow } from "@/lib/export/tabular";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const DATASETS = new Set<ExportDatasetKey>([
  "customers",
  "requests",
  "quotations",
  "jobs",
  "invoices",
]);

async function requireBusinessOwner(request: Request) {
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

    if (!businessId || (role !== "owner" && role !== "admin")) {
      return {
        ok: false as const,
        status: 403,
        error: "Business owner access required.",
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

function isExportRow(value: unknown): value is ExportRow {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: Request) {
  const auth = await requireBusinessOwner(request);
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

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: 400 },
    );
  }

  const payload = body as Record<string, unknown>;
  const dataset =
    typeof payload.dataset === "string" ? payload.dataset.trim() : "";
  if (!DATASETS.has(dataset as ExportDatasetKey)) {
    return NextResponse.json(
      { ok: false, error: "Choose a valid dataset to import." },
      { status: 400 },
    );
  }

  const rowsRaw = Array.isArray(payload.rows) ? payload.rows : [];
  const rows = rowsRaw.filter(isExportRow);
  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No data rows found in the CSV." },
      { status: 400 },
    );
  }
  if (rows.length > IMPORT_MAX_ROWS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Import is limited to ${IMPORT_MAX_ROWS} rows at a time.`,
      },
      { status: 400 },
    );
  }

  const result = await importBusinessDataset({
    auth: {
      uid: auth.uid,
      email: auth.email,
      name: auth.name,
      role: auth.role,
      businessId: auth.businessId,
    },
    dataset: dataset as ExportDatasetKey,
    rows,
  });

  return NextResponse.json({ ok: true, ...result });
}
